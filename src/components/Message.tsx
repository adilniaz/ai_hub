import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  Copy,
  RotateCcw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import {
  classNames,
  copyText,
  formatDuration,
  formatNumber,
  formatTime,
  getModelDisplayName,
} from "../lib/utils";
import { Logo } from "./Logo";
import { Markdown } from "./Markdown";

interface MessageProps {
  message: ChatMessage;
  isStreaming: boolean;
  isLastAssistant: boolean;
  onRegenerate: () => void;
  onImageClick: (src: string) => void;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await copyText(text);
      setCopied(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      aria-label={copied ? "Copied" : label}
      className={classNames("message-action", copied && "is-confirmed")}
      title={copied ? "Copied" : label}
      type="button"
      onClick={handleCopy}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function MessageStats({ message }: { message: ChatMessage }) {
  if (!message.stats) return null;
  const stats = message.stats;
  const parts: string[] = [];
  if (stats.tokensPerSecond > 0) {
    parts.push(`${stats.tokensPerSecond.toFixed(1)} tok/s`);
  }
  if (stats.evalCount > 0) {
    parts.push(`${formatNumber(stats.evalCount)} tokens`);
  }
  if (stats.totalDuration > 0) {
    parts.push(formatDuration(stats.totalDuration));
  }
  if (parts.length === 0) return null;

  return (
    <div className="message-stats" title="Generation statistics">
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </div>
  );
}

export function Message({
  message,
  isStreaming,
  isLastAssistant,
  onRegenerate,
  onImageClick,
}: MessageProps) {
  const isAssistant = message.role === "assistant";
  const modelName = message.model
    ? getModelDisplayName(message.model, 36)
    : "Assistant";
  const hasContent = Boolean(message.content);
  const hasThinking = Boolean(message.thinking);

  if (!isAssistant) {
    return (
      <article className="message message-user">
        <div className="user-message-body">
          {message.images && message.images.length > 0 ? (
            <div className="message-images">
              {message.images.map((image, index) => (
                <button
                  aria-label={`View attached image ${index + 1}`}
                  className="message-image"
                  key={`${message.id}-${index}`}
                  type="button"
                  onClick={() => onImageClick(image)}
                >
                  <img alt={`Attachment ${index + 1}`} src={image} />
                </button>
              ))}
            </div>
          ) : null}
          {message.content ? (
            <div className="user-bubble">{message.content}</div>
          ) : null}
        </div>
        <div className="user-message-footer">
          <CopyButton label="Copy message" text={message.content} />
          <time dateTime={new Date(message.createdAt).toISOString()}>
            {formatTime(message.createdAt)}
          </time>
        </div>
      </article>
    );
  }

  return (
    <article className="message message-assistant">
      <div className="assistant-gutter">
        <span className="assistant-mark">
          <Logo size={16} />
        </span>
      </div>
      <div className="assistant-content">
        <div className="assistant-header">
          <span className="assistant-name" title={message.model}>
            {modelName}
          </span>
          <span className="assistant-byline">local</span>
          {isStreaming ? (
            <span className="generating-label">
              <span className="generating-pulse" />
              generating
            </span>
          ) : null}
        </div>

        {hasThinking ? (
          <details className="thinking-block">
            <summary>
              <Brain size={14} />
              <span>{isStreaming && !hasContent ? "Thinking…" : "Reasoning"}</span>
              <ChevronDown className="thinking-chevron" size={14} />
            </summary>
            <div className="thinking-content">{message.thinking}</div>
          </details>
        ) : null}

        {!hasContent && isStreaming ? (
          <div className="typing-indicator" aria-label="Assistant is thinking">
            <span />
            <span />
            <span />
            <em>{hasThinking ? "Reasoning through it" : "Thinking"}</em>
          </div>
        ) : null}

        {hasContent ? (
          <div className="assistant-body">
            <Markdown content={message.content} streaming={isStreaming} />
          </div>
        ) : null}

        {message.error ? (
          <div className="message-error" role="alert">
            <AlertTriangle size={15} />
            <div>
              <strong>Generation failed</strong>
              <p>{message.error}</p>
            </div>
          </div>
        ) : null}

        {message.stopped ? (
          <div className="stopped-note">Response stopped</div>
        ) : null}

        <div className="assistant-footer">
          <div className="message-actions">
            {hasContent ? (
              <CopyButton label="Copy response" text={message.content} />
            ) : null}
            {isLastAssistant && !isStreaming ? (
              <button
                aria-label={message.error ? "Retry response" : "Regenerate response"}
                className="message-action"
                title={message.error ? "Retry" : "Regenerate"}
                type="button"
                onClick={onRegenerate}
              >
                <RotateCcw size={14} />
              </button>
            ) : null}
          </div>
          <div className="message-meta">
            <MessageStats message={message} />
            <time dateTime={new Date(message.createdAt).toISOString()}>
              {formatTime(message.createdAt)}
            </time>
          </div>
        </div>
      </div>
    </article>
  );
}
