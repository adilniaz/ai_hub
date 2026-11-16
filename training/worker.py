#!/usr/bin/env python3
"""Isolated training worker.

The FastAPI process executes this file as a subprocess.  In particular, unsloth,
TRL, torch, and transformers are deliberately imported only inside run_job().
Stdout is a stream of newline-delimited JSON events for the parent process;
third-party libraries may also write plain-text lines, which the parent treats
as log messages.
"""

from __future__ import annotations

import argparse
import inspect
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import traceback
from typing import Any


TRAINING_DIR = Path(__file__).resolve().parent
JOB_ROOT = TRAINING_DIR.parent / ".training" / "jobs"
MODEL_NAME_RE = re.compile(
    r"^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[a-z0-9]+(?:[._-][a-z0-9]+)*)?$"
)


class JobCancelled(Exception):
    """Raised by a signal handler when the parent requests cancellation."""


def emit(event_type: str, **payload: Any) -> None:
    """Write one machine-readable event and flush it immediately."""

    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def _cancel_handler(signum: int, _frame: Any) -> None:
    raise JobCancelled(f"Received signal {signum}")


def _run_ollama_list() -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("The 'ollama' executable was not found on PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Timed out while querying installed Ollama models.") from exc


def _installed_model_names() -> set[str]:
    result = _run_ollama_list()
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"Could not query Ollama models: {detail or 'ollama list failed'}")

    names: set[str] = set()
    for line in result.stdout.splitlines():
        columns = line.strip().split()
        if not columns:
            continue
        name = columns[0]
        if name.upper() == "NAME":
            continue
        names.add(name)
    return names


def _model_aliases(model_name: str) -> set[str]:
    aliases = {model_name}
    if ":" not in model_name:
        aliases.add(f"{model_name}:latest")
    return aliases


def ensure_output_is_new(model_name: str) -> None:
    """Refuse to replace an existing local model, including an implicit :latest."""

    if not MODEL_NAME_RE.fullmatch(model_name):
        raise ValueError(f"Unsafe or invalid Ollama model name: {model_name!r}")
    if _model_aliases(model_name) & _installed_model_names():
        raise RuntimeError(
            f"Ollama model {model_name!r} already exists; choose a new outputName. "
            "The worker never overwrites installed models."
        )


def character_system_prompt(character: dict[str, Any]) -> str:
    labels = (
        ("setting", "Setting"),
        ("personality", "Personality"),
        ("speakingStyle", "Speaking style"),
        ("backstory", "Backstory"),
        ("avoid", "Avoid"),
    )
    sections = [
        f"You are {character['name']}, a wholly fictional character. "
        "Respond in character while remaining honest that you are an AI when asked."
    ]
    for key, label in labels:
        sections.append(f"{label}: {character[key]}")
    return "\n\n".join(sections)


def load_job(job_dir: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    with (job_dir / "project.json").open("r", encoding="utf-8") as handle:
        project = json.load(handle)

    examples: list[dict[str, Any]] = []
    with (job_dir / "dataset.jsonl").open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            record = json.loads(line)
            if record.get("split", "train") != "train":
                continue
            examples.append(record)
    if not examples:
        raise ValueError("The job dataset contains no training examples.")
    return project, examples


def _parameter_supported(callable_object: Any, name: str) -> bool:
    try:
        return name in inspect.signature(callable_object).parameters
    except (TypeError, ValueError):
        return False


def run_job(job_dir: Path) -> None:
    # Keep allocator behavior conservative on the 6 GB development GPU. These
    # are set before importing the training stack and can be overridden outside.
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

    project, examples = load_job(job_dir)
    model_name = project["outputName"]
    ensure_output_is_new(model_name)

    emit("stage", stage="preparing", message="Loading the local training stack")
    from unsloth import FastLanguageModel, is_bfloat16_supported
    import torch
    from datasets import Dataset
    from transformers import TrainerCallback
    from trl import SFTConfig, SFTTrainer

    max_seq_length = int(project["maxSeqLength"])
    emit("log", message=f"Loading base model {project['baseModel']} in 4-bit mode")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=project["baseModel"],
        max_seq_length=max_seq_length,
        dtype=None,
        load_in_4bit=True,
    )
    if not tokenizer.chat_template:
        raise RuntimeError("The selected tokenizer does not provide a chat template.")

    model = FastLanguageModel.get_peft_model(
        model,
        r=8,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        lora_alpha=16,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=3407,
        use_rslora=False,
        loftq_config=None,
    )

    system_prompt = character_system_prompt(project["character"])

    def render(example: dict[str, Any]) -> dict[str, str]:
        messages = [{"role": "system", "content": system_prompt}, *example["messages"]]
        return {
            "text": tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=False,
            )
        }

    # The evaluation split was excluded by load_job and is never passed to the
    # trainer. Rendering here (rather than letting TRL infer a template) makes
    # the system prompt and assistant-turn formatting explicit.
    dataset = Dataset.from_list(examples).map(render, remove_columns=["messages", "split"])

    class ProgressCallback(TrainerCallback):
        def on_train_begin(self, args: Any, state: Any, control: Any, **kwargs: Any) -> None:
            emit(
                "stage",
                stage="training",
                message=f"Training on {len(examples)} examples; evaluation examples are held out",
            )

        def on_log(self, args: Any, state: Any, control: Any, logs: Any = None, **kwargs: Any) -> None:
            logs = logs or {}
            loss = logs.get("loss")
            emit(
                "progress",
                stage="training",
                step=int(state.global_step or 0),
                totalSteps=int(state.max_steps or 0),
                loss=float(loss) if isinstance(loss, (int, float)) else None,
                message=f"Training step {int(state.global_step or 0)}/{int(state.max_steps or 0)}",
            )

        def on_step_end(self, args: Any, state: Any, control: Any, **kwargs: Any) -> None:
            # A step event also guarantees progress when a TRL version sends no
            # scalar loss in its final log record.
            emit(
                "progress",
                stage="training",
                step=int(state.global_step or 0),
                totalSteps=int(state.max_steps or 0),
                loss=None,
                message=f"Completed training step {int(state.global_step or 0)}/{int(state.max_steps or 0)}",
            )

    adapter_dir = job_dir / "artifacts" / "adapter"
    checkpoint_dir = job_dir / "artifacts" / "checkpoints"
    adapter_dir.mkdir(parents=True, exist_ok=True)
    config_values: dict[str, Any] = {
        "output_dir": str(checkpoint_dir),
        "per_device_train_batch_size": 1,
        "gradient_accumulation_steps": 8,
        "gradient_checkpointing": True,
        "num_train_epochs": float(project["epochs"]),
        "learning_rate": float(project["learningRate"]),
        "warmup_ratio": 0.03,
        "lr_scheduler_type": "linear",
        "optim": "adamw_8bit",
        "weight_decay": 0.01,
        "logging_steps": 1,
        "save_strategy": "no",
        "report_to": "none",
        "seed": 3407,
        "dataset_num_proc": 1,
        "fp16": not is_bfloat16_supported(),
        "bf16": is_bfloat16_supported(),
    }
    if _parameter_supported(SFTConfig, "max_length"):
        config_values["max_length"] = max_seq_length
    elif _parameter_supported(SFTConfig, "max_seq_length"):
        config_values["max_seq_length"] = max_seq_length
    else:
        raise RuntimeError("This TRL SFTConfig exposes neither max_length nor max_seq_length.")
    if _parameter_supported(SFTConfig, "packing"):
        config_values["packing"] = False
    if _parameter_supported(SFTConfig, "gradient_checkpointing_kwargs"):
        config_values["gradient_checkpointing_kwargs"] = {"use_reentrant": False}

    training_args = SFTConfig(**config_values)
    trainer_values: dict[str, Any] = {
        "model": model,
        "args": training_args,
        "train_dataset": dataset,
        "formatting_func": lambda example: example["text"],
        "callbacks": [ProgressCallback()],
    }
    # TRL renamed tokenizer to processing_class. Both paths pass the already
    # configured tokenizer; no template selection is left to TRL.
    if _parameter_supported(SFTTrainer, "processing_class"):
        trainer_values["processing_class"] = tokenizer
    else:
        trainer_values["tokenizer"] = tokenizer

    trainer = SFTTrainer(**trainer_values)
    trainer.train()

    emit("stage", stage="training", message="Training finished; saving the LoRA adapter")
    trainer.save_model(str(adapter_dir))
    tokenizer.save_pretrained(str(adapter_dir))
    (job_dir / "artifacts" / "training_summary.json").write_text(
        json.dumps(
            {
                "baseModel": project["baseModel"],
                "trainExamples": len(examples),
                "epochs": project["epochs"],
                "maxSeqLength": max_seq_length,
                "globalStep": int(trainer.state.global_step),
                # The last log entry is the end-of-run summary, which carries
                # train_loss rather than loss; take the last per-step loss.
                "finalLoss": next(
                    (
                        entry["loss"]
                        for entry in reversed(trainer.state.log_history)
                        if "loss" in entry
                    ),
                    None,
                ),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    emit("stage", stage="exporting", message="Merging the adapter and exporting GGUF q4_k_m")
    gguf_dir = job_dir / "artifacts" / "gguf"
    gguf_dir.mkdir(parents=True, exist_ok=True)
    # Unsloth merges the trained LoRA weights to 16-bit inside this job's
    # artifact directory before quantizing the export for Ollama.
    model.save_pretrained_gguf(
        str(gguf_dir),
        tokenizer,
        quantization_method="q4_k_m",
    )
    # Current Unsloth releases may place converted files in a sibling
    # `<name>_gguf` directory rather than beneath the supplied output path.
    # Search the job's isolated artifact tree and prefer the requested quant.
    gguf_files = sorted((job_dir / "artifacts").rglob("*.gguf"))
    if not gguf_files:
        raise RuntimeError("Unsloth reported export completion but produced no GGUF file.")
    preferred = [path for path in gguf_files if "q4_k_m" in path.name.lower()]
    gguf_path = (preferred or gguf_files)[0].resolve()

    emit("stage", stage="registering", message="Checking Ollama and registering the new model")
    # Check again immediately before creation in case somebody installed the
    # requested name while this job was training.
    ensure_output_is_new(model_name)
    modelfile_path = job_dir / "artifacts" / "Modelfile"
    # Ollama's triple-quoted SYSTEM form preserves newlines. Prevent character
    # text from terminating that form early; JSON quoting protects FROM paths.
    safe_system_prompt = system_prompt.replace('"""', "'''")
    modelfile_path.write_text(
        f"FROM {json.dumps(str(gguf_path))}\n\n"
        f'SYSTEM """\n{safe_system_prompt}\n"""\n\n'
        "PARAMETER temperature 0.7\n",
        encoding="utf-8",
    )

    try:
        result = subprocess.run(
            ["ollama", "create", model_name, "-f", str(modelfile_path)],
            cwd=job_dir,
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("The 'ollama' executable was not found on PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Ollama model registration timed out after 10 minutes.") from exc

    for output in (result.stdout, result.stderr):
        for line in output.splitlines():
            if line.strip():
                emit("log", message=f"ollama: {line.strip()}")
    if result.returncode != 0:
        raise RuntimeError(f"ollama create failed with exit code {result.returncode}.")

    # Registration is the final success condition. Merely reaching GGUF export
    # is not reported as a complete job.
    emit("stage", stage="complete", message=f"Registered Ollama model {model_name}")
    emit("complete", modelName=model_name, message=f"Model {model_name} is ready in Ollama")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one local character QLoRA job")
    parser.add_argument("--job-dir", required=True, type=Path)
    args = parser.parse_args()

    try:
        job_dir = args.job_dir.resolve()
        if job_dir.parent != JOB_ROOT.resolve() or not job_dir.is_dir():
            raise ValueError("job-dir must be an existing job directory under .training/jobs")
        run_job(job_dir)
        return 0
    except JobCancelled as exc:
        emit("cancelled", message=str(exc) or "Training cancelled")
        return 130
    except Exception as exc:
        emit("error", message=str(exc) or exc.__class__.__name__)
        for line in traceback.format_exc(limit=30).splitlines():
            emit("log", message=line)
        return 1


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _cancel_handler)
    signal.signal(signal.SIGINT, _cancel_handler)
    sys.exit(main())
