import type {
  ChatMessage,
  Conversation,
  ModelOptions,
  Settings,
} from "../types";
import { fontScaleRange, uiScaleRange } from "./display";

const SETTINGS_KEY = "local-chat.settings.v1";
const CONVERSATIONS_KEY = "local-chat.conversations.v1";

export const defaultSettings: Settings = {
  theme:
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  systemPrompt: "",
  temperature: 0.7,
  numCtx: 0,
  lastModel: "",
  modelOptions: {},
  fontScale: 1,
  uiScale: 1,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMessage(value: unknown): value is ChatMessage {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "number"
  );
}

function isConversation(value: unknown): value is Conversation {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    typeof value.model === "string" &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage)
  );
}

function readOptionNumber(
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  if (integer && !Number.isInteger(value)) return undefined;
  return value;
}

function loadModelOptions(value: unknown): ModelOptions {
  if (!isObject(value)) return {};

  const options: ModelOptions = {};
  const numCtx = readOptionNumber(value.numCtx, 0, 4_194_304, true);
  const temperature = readOptionNumber(value.temperature, 0, 2);
  const topP = readOptionNumber(value.topP, 0, 1);
  const topK = readOptionNumber(value.topK, 1, 10_000, true);
  const repeatPenalty = readOptionNumber(value.repeatPenalty, 0, 4);
  const seed = readOptionNumber(value.seed, 0, 2_147_483_647, true);
  const numPredict = readOptionNumber(value.numPredict, 1, 1_048_576, true);

  if (numCtx !== undefined) options.numCtx = numCtx;
  if (temperature !== undefined) options.temperature = temperature;
  if (topP !== undefined) options.topP = topP;
  if (topK !== undefined) options.topK = topK;
  if (repeatPenalty !== undefined) options.repeatPenalty = repeatPenalty;
  if (seed !== undefined) options.seed = seed;
  if (numPredict !== undefined) options.numPredict = numPredict;
  if (
    typeof value.keepAlive === "string" &&
    ["0", "5m", "15m", "30m", "1h"].includes(value.keepAlive)
  ) {
    options.keepAlive = value.keepAlive;
  }

  return options;
}

function loadModelOptionsMap(value: unknown): Record<string, ModelOptions> {
  if (!isObject(value)) return {};
  const result: Record<string, ModelOptions> = {};
  for (const [model, rawOptions] of Object.entries(value)) {
    const options = loadModelOptions(rawOptions);
    if (Object.keys(options).length > 0) result[model] = options;
  }
  return result;
}

export function loadConversations(): Conversation[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(CONVERSATIONS_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConversation);
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): boolean {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(): Settings {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(SETTINGS_KEY) ?? "null",
    );
    if (!isObject(parsed)) return defaultSettings;

    const temperature =
      typeof parsed.temperature === "number" &&
      Number.isFinite(parsed.temperature)
        ? Math.min(2, Math.max(0, parsed.temperature))
        : defaultSettings.temperature;
    const numCtx =
      typeof parsed.numCtx === "number" && Number.isFinite(parsed.numCtx)
        ? Math.max(0, Math.round(parsed.numCtx))
        : defaultSettings.numCtx;

    return {
      theme:
        parsed.theme === "light" || parsed.theme === "dark"
          ? parsed.theme
          : defaultSettings.theme,
      systemPrompt:
        typeof parsed.systemPrompt === "string"
          ? parsed.systemPrompt
          : defaultSettings.systemPrompt,
      temperature,
      numCtx,
      lastModel:
        typeof parsed.lastModel === "string"
          ? parsed.lastModel
          : defaultSettings.lastModel,
      modelOptions: loadModelOptionsMap(parsed.modelOptions),
      fontScale:
        readOptionNumber(
          parsed.fontScale,
          fontScaleRange.min,
          fontScaleRange.max,
        ) ?? defaultSettings.fontScale,
      uiScale:
        readOptionNumber(parsed.uiScale, uiScaleRange.min, uiScaleRange.max) ??
        defaultSettings.uiScale,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings are small, but storage can still be unavailable in private mode.
  }
}
