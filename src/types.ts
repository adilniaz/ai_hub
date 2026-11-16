export type Role = "user" | "assistant";

export interface MessageStats {
  totalDuration: number;
  loadDuration: number;
  promptEvalCount: number;
  evalCount: number;
  tokensPerSecond: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  thinking?: string;
  images?: string[];
  createdAt: number;
  model?: string;
  stats?: MessageStats;
  error?: string;
  stopped?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  messages: ChatMessage[];
}

export interface ModelOptions {
  numCtx?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  seed?: number;
  numPredict?: number;
  keepAlive?: string;
}

export interface Settings {
  theme: "light" | "dark";
  systemPrompt: string;
  temperature: number;
  numCtx: number;
  lastModel: string;
  modelOptions: Record<string, ModelOptions>;
  fontScale: number;
  uiScale: number;
}

export interface ModelInfo {
  name: string;
  size: number;
  modifiedAt: number;
  parameterSize?: string;
  quantization?: string;
  family?: string;
  contextLength?: number;
  capabilities: string[];
}

export type ModelsState =
  | { status: "loading"; models: ModelInfo[]; error: null }
  | { status: "ready"; models: ModelInfo[]; error: null }
  | { status: "error"; models: ModelInfo[]; error: string };

export interface AttachmentImage {
  id: string;
  name: string;
  dataUrl: string;
}

export interface ToastState {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ApiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}
