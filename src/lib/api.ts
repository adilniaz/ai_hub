import type {
  ApiChatMessage,
  MessageStats,
  ModelInfo,
  ModelOptions,
} from "../types";

interface RawModel {
  name?: string;
  model?: string;
  modified_at?: string;
  size?: number;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
    context_length?: number;
  };
  capabilities?: string[];
}

interface RawTagsResponse {
  models?: RawModel[];
}

interface RawChatChunk {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
  };
  done?: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `Request failed with status ${response.status}.`;
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      return parsed.error;
    }
  } catch {
    // The response was not JSON.
  }
  return text;
}

export async function fetchModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  let response: Response;
  try {
    response = await fetch("/api/tags", { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error(
      "Could not reach Ollama. Make sure `ollama serve` is running.",
    );
  }

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = (await response.json()) as RawTagsResponse;
  const models = (data.models ?? [])
    .filter((model): model is RawModel & { name?: string; model: string } =>
      Boolean(model.model || model.name),
    )
    .map((model) => {
      const name = model.name ?? model.model ?? "";
      return {
        name,
        size: model.size ?? 0,
        modifiedAt: model.modified_at ? Date.parse(model.modified_at) : 0,
        parameterSize: model.details?.parameter_size,
        quantization: model.details?.quantization_level,
        family: model.details?.family,
        contextLength: model.details?.context_length,
        capabilities: model.capabilities ?? [],
      } satisfies ModelInfo;
    });

  return models.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

interface StreamChatOptions {
  model: string;
  messages: ApiChatMessage[];
  options: ModelOptions;
  signal?: AbortSignal;
  onToken: (token: { content: string; thinking: string }) => void;
  onDone: (stats: MessageStats) => void;
}

export async function streamChat({
  model,
  messages,
  options: modelOptions,
  signal,
  onToken,
  onDone,
}: StreamChatOptions): Promise<void> {
  const options: Record<string, number> = {};
  if (modelOptions.temperature !== undefined) {
    options.temperature = modelOptions.temperature;
  }
  if (modelOptions.numCtx !== undefined && modelOptions.numCtx > 0) {
    options.num_ctx = modelOptions.numCtx;
  }
  if (modelOptions.topP !== undefined) options.top_p = modelOptions.topP;
  if (modelOptions.topK !== undefined) options.top_k = modelOptions.topK;
  if (modelOptions.repeatPenalty !== undefined) {
    options.repeat_penalty = modelOptions.repeatPenalty;
  }
  if (modelOptions.seed !== undefined) options.seed = modelOptions.seed;
  if (modelOptions.numPredict !== undefined) {
    options.num_predict = modelOptions.numPredict;
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    options,
  };
  if (modelOptions.keepAlive) {
    body.keep_alive =
      modelOptions.keepAlive === "0" ? 0 : modelOptions.keepAlive;
  }

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (!response.body) {
    throw new Error("Ollama returned an empty response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let chunk: RawChatChunk;
    try {
      chunk = JSON.parse(trimmed) as RawChatChunk;
    } catch {
      return;
    }

    if (chunk.error) throw new Error(chunk.error);

    if (chunk.message?.content || chunk.message?.thinking) {
      onToken({
        content: chunk.message.content ?? "",
        thinking: chunk.message.thinking ?? "",
      });
    }

    if (chunk.done) {
      const evalCount = chunk.eval_count ?? 0;
      const evalDuration = chunk.eval_duration ?? 0;
      onDone({
        totalDuration: (chunk.total_duration ?? 0) / 1_000_000,
        loadDuration: (chunk.load_duration ?? 0) / 1_000_000,
        promptEvalCount: chunk.prompt_eval_count ?? 0,
        evalCount,
        tokensPerSecond:
          evalDuration > 0 ? evalCount / (evalDuration / 1_000_000_000) : 0,
      });
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    }

    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
  } finally {
    reader.releaseLock();
  }
}
