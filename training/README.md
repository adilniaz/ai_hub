# Local character fine-tuning pilot

This directory contains a small FastAPI control plane and an isolated QLoRA worker for creating a fictional character model and registering it with Ollama. It is intended for local pipeline experiments, not as a hosted training service.

The sample character, **Mara Vella**, and the Brinehook coast are wholly fictional. The 20 manually written examples (16 training and 4 held-out evaluation examples) are only enough to test data flow, training, export, and registration. **They are not enough for a polished character model, and neither character quality nor factual reliability is guaranteed.** A 1B model will remain limited even with a larger dataset.

## Setup

From the repository root, use Python 3.11 and install the pinned training stack in its own environment:

```bash
python3.11 -m venv .venv-training
.venv-training/bin/python -m pip install --upgrade pip
.venv-training/bin/python -m pip install -r training/requirements.txt
```

Unsloth has platform-specific CUDA/PyTorch requirements. Consult the installation instructions for the pinned Unsloth release if the generic install does not match the host. This pilot expects a working NVIDIA driver (`nvidia-smi`), a CUDA-capable Unsloth/PyTorch installation, and the `ollama` command on `PATH`. Ollama must be running before a job is submitted.

Start the API **from this directory** so that its module imports and documented command match:

```bash
cd training
../.venv-training/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8765
```

Equivalently, after activating `.venv-training`, run:

```bash
python -m uvicorn app:app --host 127.0.0.1 --port 8765
```

The app binds only to loopback. No CORS route is enabled because the frontend same-origin proxy forwards `/training/*` here and strips `/training`. For example, frontend `GET /training/status` reaches backend `GET /status`.

The web process does not import Unsloth, TRL, PEFT, torch, or transformers. Consequently, once FastAPI and Uvicorn are available, `/status`, `/project`, and dataset validation can run while training dependencies are still being installed. Dependency discovery does not guarantee that CUDA or every transitive binary dependency is healthy; worker logs provide the definitive failure details.

## API and persisted state

- `GET /status`: interpreter, dependency availability, NVIDIA GPU memory, and readiness.
- `GET /project`: the saved project, or the Mara starter project if none has been saved.
- `PUT /project`: validate and save a complete project and its inline JSONL dataset.
- `POST /validate`: validate `{"dataset": "...JSONL..."}` without starting a job.
- `POST /jobs`: validate and save a complete project, reject duplicate output models, and start one worker if no other job is active.
- `GET /jobs/current`: current or most recent job, including its latest 100 log lines.
- `POST /jobs/cancel`: request graceful cancellation of the active process group.

Mutable state is stored only under the repository's `.training/` directory:

```text
.training/
  project.json
  jobs/<job-id>/
    project.json          # sanitized copy, including inline dataset
    dataset.jsonl         # canonical, sanitized JSONL
    job.json              # API job state and recent logs
    worker.log            # complete worker stdout/stderr stream
    artifacts/
      adapter/            # LoRA adapter and tokenizer files
      checkpoints/        # trainer output directory (automatic saving disabled)
      gguf/               # merged weights used for conversion
      gguf_gguf/          # GGUF files (location varies by Unsloth release)
      Modelfile
      training_summary.json
```

Restarting the API marks an unfinished in-memory job as interrupted; it does not resume training. Full worker output remains in `worker.log`, while API job logs are capped at 100 recent lines.

## Project and dataset format

`default_project.json` contains the default character card and conservative training settings. `default_dataset.jsonl` contains the inline starter data returned by `GET /project`. A project has this shape:

```json
{
  "version": 1,
  "character": {
    "name": "Mara Vella",
    "setting": "...",
    "personality": "...",
    "speakingStyle": "...",
    "backstory": "...",
    "avoid": "..."
  },
  "baseModel": "unsloth/Llama-3.2-1B-Instruct",
  "outputName": "mara-vella",
  "dataset": "{\"split\":\"train\",\"messages\":[...]}",
  "maxSeqLength": 1024,
  "epochs": 1,
  "learningRate": 0.0002
}
```

The `dataset` value is JSONL **text**, not a filename. Each nonblank line is an object with two to forty alternating messages, beginning with `user` and ending with `assistant`:

```json
{"split":"train","messages":[{"role":"user","content":"How do you prepare for a storm?"},{"role":"assistant","content":"I check the lamp first, then the shutters and fuel."}]}
{"split":"evaluation","messages":[{"role":"user","content":"What helps you wait?"},{"role":"assistant","content":"A useful task, an honest forecast, and tea."}]}
```

`split` defaults to `train`. Use `evaluation` for held-out examples; the worker never passes them to the trainer. This implementation does not compute an evaluation score, so reserve those examples for separate manual or automated comparison. Do not put system messages in JSONL. The worker builds one system prompt from the character card, prepends it to every conversation, and renders the full conversation with the base tokenizer's own `apply_chat_template`.

Validation rejects malformed JSON, unsupported fields, non-alternating roles, empty or oversized messages, excessive datasets, and datasets without training examples. It does not assess whether responses are good, consistent, safe for a particular application, or legally appropriate. Review and curate real training data separately; do not include private information.

## Training, export, and cancellation

The worker uses Unsloth `FastLanguageModel` and TRL `SFTTrainer` with QLoRA defaults chosen for a 6 GB RTX 4050:

- 4-bit base model loading and LoRA rank 8;
- sequence length 1024;
- per-device batch size 1 and gradient accumulation 8;
- Unsloth gradient checkpointing;
- one epoch and learning rate `2e-4`;
- 8-bit AdamW and mixed precision selected for the GPU.

Project values for sequence length, epochs, and learning rate are honored within API limits. Larger values or a different base model can exceed 6 GB. Downloads and Ollama inference also require disk space, and Ollama may need GPU memory when testing the result. Out-of-memory failures, driver incompatibilities, and conversion failures are possible.

After training, the adapter is saved separately. Unsloth `save_pretrained_gguf` merges the adapter for a `q4_k_m` GGUF export. Depending on the Unsloth release, converted GGUF files can appear in a sibling `*_gguf` directory; the worker locates them within the job's isolated artifact tree. It creates a Modelfile using the absolute GGUF path, the character system prompt, and temperature 0.7, then runs:

```text
ollama create <new-output-name> -f <job-artifacts>/Modelfile
```

A job is complete only if this registration succeeds. Both the API and worker query `ollama list`, including a second worker check immediately before registration. Existing Ollama models are never overwritten, and the base model is not modified. Output names are restricted to a lowercase Ollama-compatible slug with an optional tag; slashes and traversal are rejected.

Cancellation signals the worker's isolated process group. The worker handles `SIGTERM`/`SIGINT`, reports cancellation, and leaves partial artifacts and logs for diagnosis. Cancellation can take until the current native training operation returns to Python. A cancelled export or registration is not reported as a usable model; use a fresh output name for a retry.

## Troubleshooting and compatibility

- Check `GET /status` first, then the current job's `log` and `.training/jobs/<id>/worker.log`.
- If readiness is false during installation, finish installing dependencies and restart the API so newly installed packages are discovered consistently.
- If model download fails, verify network/Hugging Face access and available disk space.
- If export fails, inspect the exact Unsloth/llama.cpp conversion error in `worker.log`; GGUF support can depend on the pinned release and base architecture.
- TRL has renamed some SFT options over time. The worker detects `max_length` versus `max_seq_length` and `processing_class` versus `tokenizer` using callable signatures. Other breaking changes in future dependency versions may still require source changes; the Unsloth version is pinned to reduce that risk.
- No shell command is constructed from project text, and subprocesses never use `shell=True`. Keep the service on loopback and do not expose job submission to untrusted users.
