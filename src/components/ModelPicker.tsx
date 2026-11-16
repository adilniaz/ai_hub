import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  Eye,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ModelInfo, ModelsState } from "../types";
import {
  classNames,
  formatBytes,
  formatNumber,
  getModelDisplayName,
} from "../lib/utils";

interface ModelPickerProps {
  modelsState: ModelsState;
  value: string;
  onChange: (model: string) => void;
  onRefresh: () => void;
}

function CapabilityIcon({ capability }: { capability: string }) {
  if (capability === "vision") {
    return <Eye size={12} aria-label="Vision" />;
  }
  if (capability === "tools") {
    return <Wrench size={12} aria-label="Tools" />;
  }
  if (capability === "thinking") {
    return <Brain size={12} aria-label="Thinking" />;
  }
  return null;
}

function ModelMeta({ model }: { model: ModelInfo }) {
  const parts = [
    model.parameterSize,
    model.quantization,
    formatBytes(model.size),
  ].filter(Boolean);
  return <span className="model-meta">{parts.join(" · ")}</span>;
}

export function ModelPicker({
  modelsState,
  value,
  onChange,
  onRefresh,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { models, status } = modelsState;

  const filteredModels = models.filter((model) => {
    const haystack = `${model.name} ${model.family ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(frame);
    };
  }, [open]);

  const handleSelect = (model: string) => {
    onChange(model);
    setOpen(false);
    setQuery("");
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ".model-option:not(:disabled)",
      ),
    );
    if (options.length === 0) return;
    event.preventDefault();
    const activeIndex = options.findIndex(
      (option) => option === document.activeElement,
    );
    const nextIndex =
      event.key === "ArrowDown"
        ? (activeIndex + 1) % options.length
        : (activeIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus();
  };

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={classNames("model-trigger", open && "is-open")}
        title={value || "Select a model"}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className="model-status-dot"
          data-state={status}
          aria-hidden="true"
        />
        <span className="model-trigger-label">
          {value ? getModelDisplayName(value, 32) : "Select model"}
        </span>
        <ChevronDown
          className={classNames("model-trigger-chevron", open && "is-open")}
          size={14}
        />
      </button>

      {open ? (
        <div className="model-popover">
          <div className="model-popover-header">
            <div>
              <h2>Models</h2>
              <p>
                {status === "ready"
                  ? `${models.length} installed via Ollama`
                  : status === "loading"
                    ? "Connecting to Ollama…"
                    : "Ollama connection issue"}
              </p>
            </div>
            <button
              aria-label="Refresh models"
              className={classNames(
                "icon-button",
                status === "loading" && "is-spinning",
              )}
              title="Refresh models"
              type="button"
              onClick={onRefresh}
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {models.length > 4 ? (
            <div className="model-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                aria-label="Search models"
                placeholder="Find a model"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}

          {status === "error" ? (
            <div className="model-error">
              <AlertCircle size={17} />
              <div>
                <strong>Can’t reach Ollama</strong>
                <p>{modelsState.error}</p>
                <code>ollama serve</code>
              </div>
            </div>
          ) : null}

          {status === "loading" && models.length === 0 ? (
            <div className="model-skeleton-list" aria-label="Loading models">
              <span />
              <span />
              <span />
            </div>
          ) : null}

          {status === "ready" && models.length === 0 ? (
            <div className="model-empty">
              <p>No models installed yet.</p>
              <code>ollama pull llama3.2</code>
            </div>
          ) : null}

          {filteredModels.length > 0 ? (
            <div
              className="model-list"
              id={listId}
              role="listbox"
              aria-label="Installed models"
              onKeyDown={handleListKeyDown}
            >
              {filteredModels.map((model) => {
                const selected = model.name === value;
                return (
                  <button
                    aria-selected={selected}
                    className={classNames(
                      "model-option",
                      selected && "is-selected",
                    )}
                    key={model.name}
                    role="option"
                    title={model.name}
                    type="button"
                    onClick={() => handleSelect(model.name)}
                  >
                    <span className="model-option-indicator">
                      {selected ? <Check size={13} /> : null}
                    </span>
                    <span className="model-option-copy">
                      <span className="model-option-name">
                        {getModelDisplayName(model.name, 36)}
                      </span>
                      <ModelMeta model={model} />
                    </span>
                    <span className="model-capabilities">
                      {model.capabilities.slice(0, 3).map((capability) => (
                        <CapabilityIcon
                          capability={capability}
                          key={capability}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {models.length > 0 && filteredModels.length === 0 ? (
            <div className="model-empty">
              <p>No model matches “{query}”.</p>
            </div>
          ) : null}

          <div className="model-popover-footer">
            <span>
              {value && modelsState.status === "ready"
                ? modelContext(models.find((model) => model.name === value))
                : "Runs entirely on your machine"}
            </span>
            <code>ollama pull &lt;model&gt;</code>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function modelContext(model: ModelInfo | undefined): string {
  if (!model?.contextLength) return "Runs entirely on your machine";
  return `${formatNumber(model.contextLength)} token context · ${formatBytes(model.size)}`;
}
