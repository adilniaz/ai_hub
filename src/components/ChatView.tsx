import {
  ArrowDown,
  ArrowUpRight,
  Code2,
  Compass,
  LoaderCircle,
  Menu,
  PenLine,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  WifiOff,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import type {
  AttachmentImage,
  Conversation,
  ModelsState,
} from "../types";
import { classNames, getModelDisplayName } from "../lib/utils";
import { Composer } from "./Composer";
import { Message } from "./Message";
import { ModelPicker } from "./ModelPicker";
import { Logo } from "./Logo";

interface Suggestion {
  icon: ComponentType<{ size?: number }>;
  title: string;
  description: string;
  prompt: string;
}

const suggestions: Suggestion[] = [
  {
    icon: Sparkles,
    title: "Make a hard idea click",
    description: "Explain it from the ground up.",
    prompt:
      "Explain how attention works in transformer models, like I'm new to machine learning. Use a simple analogy.",
  },
  {
    icon: PenLine,
    title: "Start with a blank page",
    description: "Draft, edit, or reimagine.",
    prompt:
      "Write a short story about a lighthouse keeper who receives a letter from the future.",
  },
  {
    icon: Code2,
    title: "Untangle some code",
    description: "Debug and understand a snippet.",
    prompt:
      "Show me a clean way to debounce a function in TypeScript, with a short explanation of how it works.",
  },
  {
    icon: Compass,
    title: "Think something through",
    description: "Make a plan or a decision.",
    prompt:
      "Help me plan a calm, focused week with room for deep work, exercise, and rest.",
  },
];

interface ChatViewProps {
  conversation: Conversation | null;
  modelsState: ModelsState;
  model: string;
  hasModelOverrides: boolean;
  streamingMessageId: string | null;
  onModelChange: (model: string) => void;
  onOpenModelSettings: () => void;
  onRefreshModels: () => void;
  onOpenSidebar: () => void;
  onSend: (input: { text: string; images: string[] }) => void;
  onStop: () => void;
  onRegenerate: () => void;
}

export function ChatView({
  conversation,
  modelsState,
  model,
  hasModelOverrides,
  streamingMessageId,
  onModelChange,
  onOpenModelSettings,
  onRefreshModels,
  onOpenSidebar,
  onSend,
  onStop,
  onRegenerate,
}: ChatViewProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<AttachmentImage[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const messages = conversation?.messages ?? [];
  const hasMessages = messages.length > 0;
  const isStreaming = Boolean(streamingMessageId);
  const activeModel = modelsState.models.find((entry) => entry.name === model);
  const supportsVision =
    activeModel?.capabilities.includes("vision") ?? false;
  const modelsReady =
    modelsState.models.length > 0 && modelsState.status !== "error";
  const canChat = modelsReady && Boolean(model);

  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    stickToBottom.current = true;
    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
  }, []);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || !stickToBottom.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!previewImage) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewImage]);

  const handleScroll = () => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const atBottom = distanceFromBottom < 80;
    stickToBottom.current = atBottom;
    setShowJump(!atBottom && hasMessages);
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    stickToBottom.current = true;
    setShowJump(false);
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  };

  const handleSend = (input: { text: string; images: string[] }) => {
    if (!canChat || isStreaming) return;
    stickToBottom.current = true;
    setShowJump(false);
    setText("");
    setImages(() => []);
    onSend(input);
    requestAnimationFrame(() => {
      const viewport = scrollRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
  };

  const applySuggestion = (prompt: string) => {
    setText(prompt);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const viewport = scrollRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
  };

  return (
    <main className="chat-main">
      <header className="topbar">
        <div className="topbar-left">
          <button
            aria-label="Open conversations"
            className="icon-button mobile-menu-button"
            type="button"
            onClick={onOpenSidebar}
          >
            <Menu size={19} />
          </button>
          <div className="topbar-title-wrap">
            <h1>{conversation?.title ?? "New chat"}</h1>
            {isStreaming ? (
              <span className="topbar-generating">
                <span />
                generating
              </span>
            ) : null}
          </div>
        </div>
        <div className="topbar-right">
          <ModelPicker
            modelsState={modelsState}
            value={model}
            onChange={onModelChange}
            onRefresh={onRefreshModels}
          />
          <button
            aria-label="Model settings"
            className={classNames(
              "model-settings-button",
              hasModelOverrides && "has-overrides",
            )}
            disabled={!model}
            title={
              hasModelOverrides
                ? "Model settings — custom options active"
                : "Model settings"
            }
            type="button"
            onClick={onOpenModelSettings}
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </header>

      <div className="chat-scroll-wrap">
        <div
          ref={scrollRef}
          className="chat-viewport"
          onScroll={handleScroll}
        >
          {!hasMessages ? (
            <ChatLanding
              canChat={canChat}
              model={model}
              modelsState={modelsState}
              onRefreshModels={onRefreshModels}
              onSuggestion={applySuggestion}
            />
          ) : (
            <div className="messages">
              {messages.map((message) => (
                <Message
                  key={message.id}
                  isLastAssistant={message.id === lastAssistantId}
                  isStreaming={message.id === streamingMessageId}
                  message={message}
                  onRegenerate={onRegenerate}
                  onImageClick={setPreviewImage}
                />
              ))}
            </div>
          )}
        </div>

        {showJump ? (
          <button
            aria-label="Jump to latest message"
            className="jump-button"
            type="button"
            onClick={() => scrollToBottom()}
          >
            <ArrowDown size={16} />
          </button>
        ) : null}
      </div>

      <Composer
        disabled={!canChat}
        images={images}
        isStreaming={isStreaming}
        model={canChat ? model : null}
        setImages={setImages}
        setText={setText}
        supportsVision={supportsVision}
        text={text}
        textareaRef={textareaRef}
        onSend={handleSend}
        onStop={onStop}
      />

      {previewImage ? (
        <div
          aria-label="Image preview"
          aria-modal="true"
          className="image-lightbox"
          role="dialog"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewImage(null);
          }}
        >
          <button
            autoFocus
            aria-label="Close image preview"
            className="lightbox-close"
            type="button"
            onClick={() => setPreviewImage(null)}
          >
            <X size={20} />
          </button>
          <img alt="Attached image preview" src={previewImage} />
        </div>
      ) : null}
    </main>
  );
}

interface ChatLandingProps {
  canChat: boolean;
  model: string;
  modelsState: ModelsState;
  onRefreshModels: () => void;
  onSuggestion: (prompt: string) => void;
}

function ChatLanding({
  canChat,
  model,
  modelsState,
  onRefreshModels,
  onSuggestion,
}: ChatLandingProps) {
  if (modelsState.status === "loading" && modelsState.models.length === 0) {
    return (
      <section className="status-state" aria-live="polite">
        <div className="status-orb is-loading">
          <Logo size={28} />
        </div>
        <p className="status-kicker">Waking up</p>
        <h2>Connecting to Ollama</h2>
        <p className="status-copy">
          Looking for models on your machine. This should only take a moment.
        </p>
        <span className="inline-loader">
          <LoaderCircle className="is-spinning" size={15} />
          Reaching localhost:11434
        </span>
      </section>
    );
  }

  if (modelsState.status === "error") {
    return (
      <section className="status-state">
        <div className="status-orb is-error">
          <WifiOff size={25} />
        </div>
        <p className="status-kicker">No connection</p>
        <h2>Ollama is out of reach.</h2>
        <p className="status-copy">
          Start the local server, then ask this page to try again. Your chats
          haven’t gone anywhere.
        </p>
        <code className="command-chip">
          <Terminal size={14} />
          ollama serve
        </code>
        <button
          className="button-primary with-icon"
          type="button"
          onClick={onRefreshModels}
        >
          <RefreshCw size={15} />
          Try again
        </button>
        {modelsState.error ? (
          <p className="status-detail">{modelsState.error}</p>
        ) : null}
      </section>
    );
  }

  if (modelsState.status === "ready" && modelsState.models.length === 0) {
    return (
      <section className="status-state">
        <div className="status-orb">
          <Terminal size={25} />
        </div>
        <p className="status-kicker">Almost there</p>
        <h2>No models yet.</h2>
        <p className="status-copy">
          Ollama is running, but it doesn’t have a model to think with. Pull one
          from your terminal and refresh.
        </p>
        <code className="command-chip">
          <Terminal size={14} />
          ollama pull llama3.2
        </code>
        <button
          className="button-primary with-icon"
          type="button"
          onClick={onRefreshModels}
        >
          <RefreshCw size={15} />
          Refresh models
        </button>
      </section>
    );
  }

  return (
    <section className="chat-landing">
      <div className="landing-spark" aria-hidden="true">
        <span className="landing-ring ring-one" />
        <span className="landing-ring ring-two" />
        <Logo className="landing-logo" size={32} />
      </div>
      <p className="landing-kicker">
        <span />
        Local intelligence, quietly yours
      </p>
      <h2>
        Where should we <em>begin?</em>
      </h2>
      <p className="landing-copy">
        Ask a question, shape an idea, or bring something you want to
        understand.
        {canChat ? (
          <>
            {" "}
            <span className="landing-model" title={model}>
              {getModelDisplayName(model, 32)} is running on this machine.
            </span>
          </>
        ) : null}
      </p>

      <div className="suggestion-grid">
        {suggestions.map((suggestion, index) => {
          const Icon = suggestion.icon;
          return (
            <button
              className="suggestion-card"
              key={suggestion.title}
              style={{ animationDelay: `${70 + index * 45}ms` }}
              type="button"
              onClick={() => onSuggestion(suggestion.prompt)}
            >
              <span className="suggestion-icon">
                <Icon size={17} />
              </span>
              <span className="suggestion-copy">
                <strong>{suggestion.title}</strong>
                <span>{suggestion.description}</span>
              </span>
              <ArrowUpRight className="suggestion-arrow" size={15} />
            </button>
          );
        })}
      </div>

      <p className="landing-note">
        <ShieldCheck size={13} />
        Your conversations stay on this machine.
      </p>
    </section>
  );
}
