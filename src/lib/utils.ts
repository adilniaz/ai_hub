import type { Conversation } from "../types";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function classNames(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function getModelLabel(name: string): string {
  if (!name) return "";
  const lastSegment = name.split("/").pop() ?? name;
  return lastSegment;
}

export function getModelDisplayName(name: string, maxLength = 34): string {
  const label = getModelLabel(name);
  if (label.length <= maxLength) return label;

  const tagIndex = label.lastIndexOf(":");
  if (tagIndex > 0 && tagIndex < label.length - 1) {
    const tag = label.slice(tagIndex + 1);
    const suffix = `:${tag}`;
    const baseRoom = maxLength - suffix.length - 1;
    if (baseRoom >= 8) {
      return `${label.slice(0, baseRoom).trimEnd()}…${suffix}`;
    }
  }

  return `${label.slice(0, Math.max(8, maxLength - 1)).trimEnd()}…`;
}

export function makeChatTitle(text: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/[#>*_`~[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Image chat";
  if (cleaned.length <= 52) return cleaned;
  const shortened = cleaned.slice(0, 52);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > 30 ? lastSpace : 52).trimEnd()}…`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 100_000 ? "compact" : "standard",
  }).format(value);
}

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "";
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export interface ChatGroup {
  label: string;
  chats: Conversation[];
}

export function groupConversations(chats: Conversation[]): ChatGroup[] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;

  const groups = new Map<string, Conversation[]>();
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);

  for (const chat of sorted) {
    let label = "Older";
    if (chat.updatedAt >= startOfToday) label = "Today";
    else if (chat.updatedAt >= startOfYesterday) label = "Yesterday";
    else if (chat.updatedAt >= startOfWeek) label = "Previous 7 days";

    const entries = groups.get(label) ?? [];
    entries.push(chat);
    groups.set(label, entries);
  }

  return ["Today", "Yesterday", "Previous 7 days", "Older"]
    .filter((label) => groups.has(label))
    .map((label) => ({ label, chats: groups.get(label) ?? [] }));
}

export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const success = document.execCommand("copy");
  textarea.remove();
  if (!success) throw new Error("Copy failed");
}

export async function prepareImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That file is not an image.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Images must be smaller than 15 MB.");
  }

  const original = await readAsDataUrl(file);
  if (file.size <= 1_500_000) return original;

  const image = await loadImage(original);
  const maxDimension = 1536;
  const scale = Math.min(
    1,
    maxDimension / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return original;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not process that image."));
    image.src = src;
  });
}
