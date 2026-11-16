# Local Chat

A private, local-first web interface for chatting with Ollama. Clean, fast, and
built to stay out of the way.

![Stack](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=white)
![Stack](https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite&logoColor=white)
![Stack](https://img.shields.io/badge/Ollama-ready-111111?style=flat-square)

## Features

- **Streaming chat** with live Markdown rendering and syntax highlighting.
- **Every installed model** is available through a searchable model picker,
  with vision, tool, and thinking capability indicators.
- **Per-model controls** for context window, sampling, seed, output length, and
  keep-alive, saved separately for each model.
- **Character studio** for local QLoRA experiments: character cards, JSONL
  validation, live training progress, GGUF export, and Ollama registration.
- **Image conversations** for vision models, with clipboard paste, drag and drop,
  image previews, and automatic compression.
- **Reasoning display** for models that return a thinking stream.
- **Local chat history** with search, rename, delete, undo, and automatic save.
- **Useful controls** for temperature, context window, system prompt, and theme.
- **Readable on any display** with separate text-size and whole-interface
  scaling controls.
- **Responsive interface** with warm light and dark themes.
- **No database, no telemetry, no account.** Chats are stored in your browser and
  model requests go directly to your Ollama instance.

## Requirements

- [Ollama](https://ollama.com) running locally (or on a reachable host).
- Node.js 20 or newer.
- At least one model installed, for example:

```bash
ollama pull llama3.2
```

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Vite proxies requests from `/api/*` to `http://127.0.0.1:11434`, which avoids
browser CORS configuration. To use a different Ollama host:

```bash
OLLAMA_HOST=http://192.168.1.20:11434 npm run dev
```

## Production

```bash
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000). The included Node server
serves the built frontend and proxies `/api/*` to Ollama, so the browser only
needs to reach one host.

For a quick local preview of the production bundle, `npm run preview` serves it
at [http://localhost:4173](http://localhost:4173) with the same API proxy.

## Character training (experimental)

The character studio requires a compatible NVIDIA GPU, Python 3.11, and a local
training service. It is separate from Ollama: Ollama runs the finished model but
does not perform training.

Set up the isolated Python environment from the project directory:

```bash
python3.11 -m venv .venv-training
.venv-training/bin/pip install -r training/requirements.txt
```

Then leave the training service running in a second terminal:

```bash
npm run training
```

Open **Character studio** in the sidebar. The included fictional Mara Vella
project has 20 examples for testing the pipeline only; it is not enough data for
a polished character. Replace it with varied, reviewed conversations and retain
some examples as `evaluation` records.

A job downloads the selected Hugging Face training checkpoint on its first run,
trains a LoRA adapter, exports a quantized GGUF, and creates a **new** Ollama
model. Existing Ollama models are never overwritten. Training artifacts and the
saved project live under `.training/`; Python dependencies live under
`.venv-training/`.

On a 6 GB GPU, start with a supported 1–3B checkpoint, 1,024-token sequences,
and one epoch. Larger models and contexts require more memory. See
[`training/README.md`](training/README.md) for data format and troubleshooting.

Environment variables:

| Variable      | Default                  | Description                     |
| ------------- | ------------------------ | ------------------------------- |
| `PORT`        | `3000`                   | Port for the production server  |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama base URL used by proxy   |
| `TRAINING_HOST` | `http://127.0.0.1:8765` | Character training service URL |

Example:

```bash
PORT=8080 OLLAMA_HOST=http://127.0.0.1:11434 npm start
```

## Usage

- Use **New chat** in the sidebar, or press `Ctrl/Cmd + Shift + O`.
- Pick a model with the pill in the top-right corner.
- Use the **sliders button** next to it to change that model’s context window,
  sampling options, and keep-alive. Overrides are saved per model.
- Attach images with the paperclip, paste them, or drag them onto the composer.
- Press **Enter** to send and **Shift + Enter** for a new line.
- Open **Settings** to change the system prompt, app-wide generation defaults,
  or theme.
- On high-DPI or distant screens, use **Settings → Display → Interface size**
  to enlarge text, controls, and spacing together. Use **Text size** if you only
  want larger type. Both settings are saved in the browser, and **Reset display
  size** restores 100%.

## Privacy

Chats live in `localStorage` under `local-chat.conversations.v1`, and settings
live under `local-chat.settings.v1`. Nothing is uploaded to a third-party
service. All generation requests go to the Ollama instance configured above.

Messages with large images can fill browser storage. If the browser reports that
storage is full, remove chats containing images or clear chat history.

The production server has no authentication, including its training-job controls.
If you expose it beyond your machine, put it behind a reverse proxy with access
control and appropriate network restrictions. Training checkpoint licenses also
apply to exported models.

## Project structure

```text
.
├── server.mjs                 # Production static server + Ollama proxy
├── src/
│   ├── App.tsx                # State, persistence, and generation orchestration
│   ├── components/            # Sidebar, chat, composer, model picker, settings
│   ├── lib/
│   │   ├── api.ts             # Ollama API client and streaming parser
│   │   ├── display.ts         # Text and interface scale ranges
│   │   ├── training.ts        # Character training API client
│   │   ├── modelOptions.ts    # Per-model generation overrides
│   │   ├── storage.ts         # Local storage and validation
│   │   └── utils.ts           # Formatting, dates, image preparation
│   ├── styles.css             # Design tokens and responsive styles
│   └── types.ts
├── public/
├── training/                  # FastAPI control plane, QLoRA worker, sample data
└── vite.config.ts             # Dev proxies for Ollama and training
```

## Troubleshooting

**“Ollama is out of reach”**

Make sure Ollama is running:

```bash
ollama serve
```

If Ollama runs on another machine, set `OLLAMA_HOST` before starting the app and
make sure that host allows connections from this machine.

**No models are listed**

Install a model and refresh the model picker:

```bash
ollama pull qwen3:8b
```

**A reply takes a long time to start**

Large models can take a while to load into memory. Generation statistics below
each response show throughput once the reply begins. Use the stop button to end
a response early.

**A reply fails after raising the context window**

Open the sliders button next to the model picker and reset the context to
**Default**. Very large windows can exceed the model’s native limit or the
memory available to Ollama.
