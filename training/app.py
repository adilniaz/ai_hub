"""Local HTTP control plane for character fine-tuning jobs.

Run from this directory with:
    python -m uvicorn app:app --host 127.0.0.1 --port 8765

Only lightweight web dependencies are imported here. The training stack lives
exclusively in worker.py and in its subprocess.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator


TRAINING_DIR = Path(__file__).resolve().parent
DATA_DIR = TRAINING_DIR.parent / ".training"
JOBS_DIR = DATA_DIR / "jobs"
PROJECT_PATH = DATA_DIR / "project.json"
DEFAULT_PROJECT_PATH = TRAINING_DIR / "default_project.json"
DEFAULT_DATASET_PATH = TRAINING_DIR / "default_dataset.jsonl"
WORKER_PATH = TRAINING_DIR / "worker.py"
MAX_LOG_LINES = 100
MAX_DATASET_BYTES = 10 * 1024 * 1024
MAX_EXAMPLES = 10_000
MAX_ERRORS = 60
MODEL_NAME_PATTERN = r"^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[a-z0-9]+(?:[._-][a-z0-9]+)*)?$"


class Character(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    setting: str = Field(min_length=1, max_length=4_000)
    personality: str = Field(min_length=1, max_length=4_000)
    speakingStyle: str = Field(min_length=1, max_length=4_000)
    backstory: str = Field(min_length=1, max_length=8_000)
    avoid: str = Field(min_length=1, max_length=4_000)


class Project(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    version: Literal[1]
    character: Character
    baseModel: str = Field(default="unsloth/Llama-3.2-1B-Instruct", min_length=1, max_length=200)
    outputName: str = Field(default="mara-vella", pattern=MODEL_NAME_PATTERN, max_length=200)
    dataset: str = Field(min_length=1, max_length=MAX_DATASET_BYTES)
    maxSeqLength: int = Field(default=1024, ge=128, le=4096)
    epochs: int = Field(default=1, ge=1, le=10)
    learningRate: float = Field(default=0.0002, gt=0, le=0.01)

    @field_validator("baseModel")
    @classmethod
    def safe_base_model(cls, value: str) -> str:
        # Base models are remote Hugging Face IDs, not arbitrary local paths.
        if (
            value.startswith(("/", ".", "-"))
            or ".." in value
            or "\\" in value
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)?", value)
        ):
            raise ValueError("baseModel must be a safe Hugging Face model ID")
        return value


class DatasetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Validation failures (including an empty dataset) are reported in the
    # endpoint's normal {valid, errors, ...} shape rather than as schema errors.
    dataset: str = Field(max_length=MAX_DATASET_BYTES)


app = FastAPI(title="Local Character Training Pilot", version="1.0.0")
_job_lock = threading.RLock()
_project_lock = threading.Lock()
_job: dict[str, Any] | None = None
_process: subprocess.Popen[str] | None = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def default_project() -> dict[str, Any]:
    project = json.loads(DEFAULT_PROJECT_PATH.read_text(encoding="utf-8"))
    project["dataset"] = DEFAULT_DATASET_PATH.read_text(encoding="utf-8")
    return project


def saved_project() -> dict[str, Any]:
    if not PROJECT_PATH.exists():
        return default_project()
    try:
        return json.loads(PROJECT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read saved project: {exc}") from exc


def parse_dataset(dataset: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Validate JSONL and return a report plus canonical, safe records."""

    errors: list[str] = []
    records: list[dict[str, Any]] = []
    examples = 0
    train_examples = 0
    evaluation_examples = 0

    def add_error(message: str) -> None:
        if len(errors) < MAX_ERRORS:
            errors.append(message)

    if len(dataset.encode("utf-8")) > MAX_DATASET_BYTES:
        add_error(f"Dataset exceeds the {MAX_DATASET_BYTES // (1024 * 1024)} MiB size limit.")

    for line_number, raw_line in enumerate(dataset.splitlines(), start=1):
        if not raw_line.strip():
            continue
        examples += 1
        if examples > MAX_EXAMPLES:
            add_error(f"Dataset exceeds the {MAX_EXAMPLES} example limit.")
            break
        try:
            raw_record = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            add_error(f"Line {line_number}: invalid JSON ({exc.msg}, column {exc.colno}).")
            continue
        if not isinstance(raw_record, dict):
            add_error(f"Line {line_number}: expected a JSON object.")
            continue
        extra_keys = set(raw_record) - {"split", "messages"}
        if extra_keys:
            add_error(f"Line {line_number}: unsupported fields: {', '.join(sorted(extra_keys))}.")
            continue

        split = raw_record.get("split", "train")
        if split not in {"train", "evaluation"}:
            add_error(f"Line {line_number}: split must be 'train' or 'evaluation'.")
            continue
        messages = raw_record.get("messages")
        if not isinstance(messages, list) or not 2 <= len(messages) <= 40:
            add_error(f"Line {line_number}: messages must contain 2 to 40 entries.")
            continue
        if len(messages) % 2:
            add_error(f"Line {line_number}: messages must start with user and end with assistant.")
            continue

        canonical_messages: list[dict[str, str]] = []
        line_valid = True
        for index, message in enumerate(messages):
            expected_role = "user" if index % 2 == 0 else "assistant"
            if not isinstance(message, dict) or set(message) != {"role", "content"}:
                add_error(f"Line {line_number}, message {index + 1}: expected only role and content.")
                line_valid = False
                break
            role = message.get("role")
            content = message.get("content")
            if role != expected_role:
                add_error(
                    f"Line {line_number}, message {index + 1}: expected role {expected_role!r}; "
                    "roles must alternate user/assistant, start with user, and end with assistant."
                )
                line_valid = False
                break
            if not isinstance(content, str) or not content.strip():
                add_error(f"Line {line_number}, message {index + 1}: content must be a nonempty string.")
                line_valid = False
                break
            if len(content) > 32_768:
                add_error(f"Line {line_number}, message {index + 1}: content exceeds 32,768 characters.")
                line_valid = False
                break
            canonical_messages.append({"role": role, "content": content.strip()})
        if not line_valid:
            continue

        if split == "train":
            train_examples += 1
        else:
            evaluation_examples += 1
        records.append({"split": split, "messages": canonical_messages})

    if examples < 2:
        add_error("Provide at least two examples for this pipeline pilot.")
    if train_examples < 1:
        add_error("Provide at least one training example.")
    if len(errors) == MAX_ERRORS:
        errors.append("Additional validation errors were omitted.")

    report = {
        "valid": not errors,
        "examples": examples,
        "trainExamples": train_examples,
        "evaluationExamples": evaluation_examples,
        "errors": errors,
    }
    return report, records


def validate_or_raise(dataset: str) -> list[dict[str, Any]]:
    report, records = parse_dataset(dataset)
    if not report["valid"]:
        raise HTTPException(status_code=422, detail={"message": "Dataset validation failed", **report})
    return records


def canonical_jsonl(records: list[dict[str, Any]]) -> str:
    return "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records)


def dependency_status() -> dict[str, bool]:
    # find_spec does not import these heavy packages or initialize CUDA in the
    # web process. It also works while the worker has its own imports in flight.
    result: dict[str, bool] = {}
    for package in ("unsloth", "trl", "peft"):
        try:
            result[package] = importlib.util.find_spec(package) is not None
        except (ImportError, AttributeError, ValueError):
            result[package] = False
    return result


def gpu_status() -> tuple[dict[str, Any] | None, str | None]:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except FileNotFoundError:
        return None, "nvidia-smi was not found; no NVIDIA GPU is visible."
    except subprocess.TimeoutExpired:
        return None, "nvidia-smi timed out."
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "nvidia-smi failed"
        return None, detail
    first_line = next((line for line in result.stdout.splitlines() if line.strip()), "")
    try:
        name, total, used = (part.strip() for part in first_line.rsplit(",", 2))
        return {"name": name, "totalMb": int(float(total)), "usedMb": int(float(used))}, None
    except (ValueError, TypeError):
        return None, "Could not parse nvidia-smi output."


def installed_ollama_models() -> set[str]:
    try:
        result = subprocess.run(
            ["ollama", "list"], capture_output=True, text=True, timeout=15, check=False
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="The 'ollama' executable was not found.") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=503, detail="Timed out querying Ollama.") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "ollama list failed"
        raise HTTPException(status_code=503, detail=f"Could not query Ollama: {detail}")

    models: set[str] = set()
    for line in result.stdout.splitlines():
        columns = line.strip().split()
        if columns and columns[0].upper() != "NAME":
            models.add(columns[0])
    return models


def refuse_existing_model(model_name: str) -> None:
    names = {model_name}
    if ":" not in model_name:
        names.add(f"{model_name}:latest")
    if names & installed_ollama_models():
        raise HTTPException(
            status_code=409,
            detail=f"Ollama model {model_name!r} already exists. Choose a new outputName; models are never overwritten.",
        )


def persist_job_locked() -> None:
    if _job is not None:
        write_json_atomic(JOBS_DIR / _job["id"] / "job.json", _job)


def snapshot_job() -> dict[str, Any] | None:
    with _job_lock:
        return copy.deepcopy(_job)


def append_job_log(job_id: str, message: str) -> None:
    with _job_lock:
        if _job is None or _job["id"] != job_id:
            return
        for line in message.rstrip().splitlines() or [""]:
            _job["log"].append(line)
        _job["log"] = _job["log"][-MAX_LOG_LINES:]
        _job["updatedAt"] = utc_now()
        persist_job_locked()


def load_last_job() -> None:
    global _job
    job_files = list(JOBS_DIR.glob("*/job.json")) if JOBS_DIR.exists() else []
    if not job_files:
        return
    latest = max(job_files, key=lambda path: path.stat().st_mtime)
    try:
        loaded = json.loads(latest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if loaded.get("status") in {"queued", "running", "cancelling"}:
        loaded["status"] = "error"
        loaded["error"] = "The backend stopped before this job finished."
        loaded["message"] = "Interrupted by a backend restart; start a new job with a new output name."
        loaded["updatedAt"] = utc_now()
    _job = loaded
    with _job_lock:
        persist_job_locked()


def monitor_worker(process: subprocess.Popen[str], job_id: str) -> None:
    saw_complete = False
    saw_cancelled = False
    worker_error: str | None = None
    full_log_path = JOBS_DIR / job_id / "worker.log"

    with full_log_path.open("a", encoding="utf-8") as full_log:
        assert process.stdout is not None
        for raw_line in process.stdout:
            full_log.write(raw_line)
            full_log.flush()
            line = raw_line.strip()
            if not line:
                continue
            # tqdm uses carriage returns and can share a physical line with a
            # worker JSON event. Preserve the human-readable prefix, but still
            # parse the event instead of losing a stage or final loss update.
            event_marker = line.find('{"type":')
            if event_marker > 0:
                append_job_log(job_id, line[:event_marker].rstrip())
                line = line[event_marker:]
            try:
                event = json.loads(line)
                if not isinstance(event, dict):
                    raise ValueError("not an event object")
            except (json.JSONDecodeError, ValueError):
                append_job_log(job_id, line)
                continue

            event_type = event.get("type")
            message = str(event.get("message") or "").strip()
            with _job_lock:
                if _job is None or _job["id"] != job_id:
                    continue
                if message:
                    _job["message"] = message
                if event_type == "log":
                    if message:
                        _job["log"].append(message)
                elif event_type == "stage":
                    stage = event.get("stage")
                    if stage in {"preparing", "training", "exporting", "registering", "complete"}:
                        _job["stage"] = stage
                    if message:
                        _job["log"].append(message)
                elif event_type == "progress":
                    previous = _job.get("progress") or {}
                    loss = event.get("loss")
                    _job["progress"] = {
                        "step": max(0, int(event.get("step") or 0)),
                        "totalSteps": max(0, int(event.get("totalSteps") or 0)),
                        "loss": float(loss)
                        if isinstance(loss, (int, float))
                        else previous.get("loss"),
                    }
                elif event_type == "error":
                    worker_error = message or "The training worker failed."
                    _job["error"] = worker_error
                    _job["log"].append(f"Error: {worker_error}")
                elif event_type == "cancelled":
                    saw_cancelled = True
                    if message:
                        _job["log"].append(message)
                elif event_type == "complete":
                    saw_complete = True
                    if message:
                        _job["log"].append(message)
                else:
                    _job["log"].append(line)
                _job["log"] = _job["log"][-MAX_LOG_LINES:]
                _job["updatedAt"] = utc_now()
                persist_job_locked()

    return_code = process.wait()
    global _process
    with _job_lock:
        if _job is not None and _job["id"] == job_id:
            was_cancelling = _job["status"] == "cancelling"
            if was_cancelling or saw_cancelled or return_code == 130:
                _job["status"] = "cancelled"
                _job["message"] = "Job cancelled. Existing Ollama models were not changed."
                _job["error"] = None
            elif return_code == 0 and saw_complete:
                _job["status"] = "complete"
                _job["stage"] = "complete"
                if _job.get("progress") and _job["progress"].get("totalSteps", 0) > 0:
                    _job["progress"]["step"] = _job["progress"]["totalSteps"]
                _job["message"] = f"Model {_job['modelName']} is ready in Ollama."
                _job["error"] = None
            else:
                _job["status"] = "error"
                _job["error"] = worker_error or f"Training worker exited with code {return_code}."
                _job["message"] = _job["error"]
            _job["log"].append(_job["message"])
            _job["log"] = _job["log"][-MAX_LOG_LINES:]
            _job["updatedAt"] = utc_now()
            persist_job_locked()
        if _process is process:
            _process = None


@app.get("/status")
def get_status() -> dict[str, Any]:
    dependencies = dependency_status()
    gpu, gpu_error = gpu_status()
    problems: list[str] = []
    missing = [name for name, available in dependencies.items() if not available]
    if missing:
        problems.append(f"Missing Python dependencies: {', '.join(missing)}.")
    if gpu_error:
        problems.append(gpu_error)
    return {
        "ready": all(dependencies.values()) and gpu is not None,
        "python": sys.executable,
        "gpu": gpu,
        "dependencies": dependencies,
        "error": None if not problems else " ".join(problems),
    }


@app.get("/project", response_model=Project)
def get_project() -> dict[str, Any]:
    return saved_project()


@app.put("/project", response_model=Project)
def put_project(project: Project) -> dict[str, Any]:
    validate_or_raise(project.dataset)
    value = project.model_dump(mode="json")
    with _project_lock:
        write_json_atomic(PROJECT_PATH, value)
    return value


@app.post("/validate")
def post_validate(payload: DatasetInput) -> dict[str, Any]:
    report, _ = parse_dataset(payload.dataset)
    return report


@app.post("/jobs")
def post_job(project: Project) -> dict[str, Any]:
    global _job, _process

    records = validate_or_raise(project.dataset)
    value = project.model_dump(mode="json")
    with _job_lock:
        if _job is not None and _job["status"] in {"queued", "running", "cancelling"}:
            raise HTTPException(status_code=409, detail="A training job is already active.")

    refuse_existing_model(project.outputName)
    job_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{uuid4().hex[:12]}"
    now = utc_now()
    job: dict[str, Any] = {
        "id": job_id,
        "status": "queued",
        "stage": "preparing",
        "message": "Preparing an isolated training job",
        "progress": None,
        "createdAt": now,
        "updatedAt": now,
        "modelName": project.outputName,
        "error": None,
        "log": ["Job accepted; no existing Ollama model will be overwritten."],
    }

    with _job_lock:
        if _job is not None and _job["status"] in {"queued", "running", "cancelling"}:
            raise HTTPException(status_code=409, detail="A training job is already active.")
        job_dir = JOBS_DIR / job_id
        artifacts_dir = job_dir / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=False)
        write_json_atomic(job_dir / "project.json", value)
        (job_dir / "dataset.jsonl").write_text(canonical_jsonl(records), encoding="utf-8")
        with _project_lock:
            write_json_atomic(PROJECT_PATH, value)

        try:
            environment = os.environ.copy()
            environment["PYTHONUNBUFFERED"] = "1"
            _process = subprocess.Popen(
                [sys.executable, str(WORKER_PATH), "--job-dir", str(job_dir)],
                cwd=TRAINING_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=environment,
                start_new_session=True,
            )
        except Exception as exc:
            job["status"] = "error"
            job["error"] = f"Could not start training worker: {exc}"
            job["message"] = job["error"]
            job["log"].append(job["error"])
            _job = job
            persist_job_locked()
            return copy.deepcopy(job)

        _job = job
        _job["status"] = "running"
        _job["updatedAt"] = utc_now()
        persist_job_locked()
        process = _process

    monitor = threading.Thread(target=monitor_worker, args=(process, job_id), daemon=True)
    monitor.start()
    return snapshot_job() or job


@app.get("/jobs/current")
def get_current_job() -> dict[str, Any] | None:
    return snapshot_job()


@app.post("/jobs/cancel")
def cancel_job() -> dict[str, Any] | None:
    with _job_lock:
        if _job is None:
            return None
        if _job["status"] not in {"queued", "running", "cancelling"}:
            return copy.deepcopy(_job)
        _job["status"] = "cancelling"
        _job["message"] = "Cancellation requested; waiting for the worker to stop."
        _job["log"].append(_job["message"])
        _job["log"] = _job["log"][-MAX_LOG_LINES:]
        _job["updatedAt"] = utc_now()
        persist_job_locked()
        process = _process
        result = copy.deepcopy(_job)

    if process is not None and process.poll() is None:
        try:
            # The worker is a session leader. Signalling its group also stops a
            # child export/ollama command while the worker handles SIGTERM.
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except OSError as exc:
            append_job_log(result["id"], f"Could not signal worker: {exc}")
    return result


load_last_job()
