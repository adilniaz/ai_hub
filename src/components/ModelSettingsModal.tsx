import { Info, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import type { ModelInfo, ModelOptions } from "../types";
import {
  classNames,
  formatBytes,
  formatNumber,
  getModelDisplayName,
} from "../lib/utils";

interface ModelSettingsModalProps {
  model: string;
  modelInfo?: ModelInfo;
  options: ModelOptions;
  defaults: { temperature: number; numCtx: number };
  onSave: (options: ModelOptions) => void;
  onReset: () => void;
  onClose: () => void;
}

type NumericField = Exclude<keyof ModelOptions, "keepAlive">;
type FormState = Record<NumericField, string>;

interface FieldSpec {
  key: NumericField;
  label: string;
  note: string;
  placeholder: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

const fieldOrder: NumericField[] = [
  "temperature",
  "topP",
  "topK",
  "repeatPenalty",
  "seed",
  "numPredict",
];

const ranges: Record<
  NumericField,
  { min: number; max: number; integer?: boolean }
> = {
  numCtx: { min: 0, max: 4_194_304, integer: true },
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  topK: { min: 1, max: 10_000, integer: true },
  repeatPenalty: { min: 0, max: 4 },
  seed: { min: 0, max: 2_147_483_647, integer: true },
  numPredict: { min: 1, max: 1_048_576, integer: true },
};

const contextPresets = [4096, 8192, 16384, 32768, 65536, 131072];

function toFormState(options: ModelOptions): FormState {
  return {
    numCtx: options.numCtx === undefined ? "" : String(options.numCtx),
    temperature:
      options.temperature === undefined ? "" : String(options.temperature),
    topP: options.topP === undefined ? "" : String(options.topP),
    topK: options.topK === undefined ? "" : String(options.topK),
    repeatPenalty:
      options.repeatPenalty === undefined
        ? ""
        : String(options.repeatPenalty),
    seed: options.seed === undefined ? "" : String(options.seed),
    numPredict:
      options.numPredict === undefined ? "" : String(options.numPredict),
  };
}

function rangeLabelForKey(key: NumericField): string {
  if (key === "numCtx") return "0 and 4,194,304";
  if (key === "temperature") return "0 and 2";
  if (key === "topP") return "0 and 1";
  if (key === "topK") return "1 and 10,000";
  if (key === "repeatPenalty") return "0 and 4";
  if (key === "seed") return "0 and 2,147,483,647";
  return "1 and 1,048,576";
}

export function ModelSettingsModal({
  model,
  modelInfo,
  options,
  defaults,
  onSave,
  onReset,
  onClose,
}: ModelSettingsModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<FormState>(() => toFormState(options));
  const [keepAlive, setKeepAlive] = useState(options.keepAlive ?? "");
  const [errors, setErrors] = useState<Partial<Record<NumericField, string>>>(
    {},
  );

  const hasOverrides = Object.keys(options).length > 0;
  const nativeContext = modelInfo?.contextLength;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;

      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (
        event.shiftKey &&
        (active === first || !modalRef.current.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !modalRef.current.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const updateField = (key: NumericField, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const handleSave = () => {
    const nextOptions: ModelOptions = {};
    const nextErrors: Partial<Record<NumericField, string>> = {};

    for (const key of fieldOrder) {
      const raw = form[key].trim();
      if (!raw) continue;
      const value = Number(raw);
      const range = ranges[key];
      if (
        !Number.isFinite(value) ||
        value < range.min ||
        value > range.max ||
        (range.integer && !Number.isInteger(value))
      ) {
        nextErrors[key] = `Use a value between ${rangeLabelForKey(key)}.`;
        continue;
      }
      nextOptions[key] = value;
    }

    const rawContext = form.numCtx.trim();
    if (rawContext) {
      const value = Number(rawContext);
      const range = ranges.numCtx;
      if (
        !Number.isFinite(value) ||
        value < range.min ||
        value > range.max ||
        !Number.isInteger(value)
      ) {
        nextErrors.numCtx = "Use a whole number of tokens.";
      } else {
        nextOptions.numCtx = value;
      }
    }

    if (keepAlive) nextOptions.keepAlive = keepAlive;

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    onSave(nextOptions);
    onClose();
  };

  const handleReset = () => {
    onReset();
    onClose();
  };

  const specs: FieldSpec[] = [
    {
      key: "temperature",
      label: "Temperature",
      note:
        form.temperature.trim() === ""
          ? `Uses your default (${defaults.temperature.toFixed(1)}).`
          : "Lower is focused; higher is more creative.",
      placeholder: defaults.temperature.toFixed(1),
      ...ranges.temperature,
      step: 0.05,
    },
    {
      key: "topP",
      label: "Top P",
      note: "Nucleus sampling. 1 keeps every token in play.",
      placeholder: "Ollama default",
      ...ranges.topP,
      step: 0.05,
    },
    {
      key: "topK",
      label: "Top K",
      note: "Only sample from the K most likely tokens.",
      placeholder: "Ollama default",
      ...ranges.topK,
      step: 1,
      integer: true,
    },
    {
      key: "repeatPenalty",
      label: "Repeat penalty",
      note: "Values above 1 discourage repeated phrases.",
      placeholder: "Ollama default",
      ...ranges.repeatPenalty,
      step: 0.05,
    },
    {
      key: "seed",
      label: "Seed",
      note: "Set a number to make sampling repeatable.",
      placeholder: "Random",
      ...ranges.seed,
      step: 1,
      integer: true,
    },
    {
      key: "numPredict",
      label: "Max output",
      note: "Maximum tokens generated per reply.",
      placeholder: "Model default",
      ...ranges.numPredict,
      step: 1,
      integer: true,
    },
  ];

  const meta = [
    modelInfo?.parameterSize,
    modelInfo?.quantization,
    modelInfo?.size ? formatBytes(modelInfo.size) : undefined,
  ].filter(Boolean);

  const contextPlaceholder =
    defaults.numCtx > 0 ? formatNumber(defaults.numCtx) : "Model default";
  const contextNumber = Number(form.numCtx);
  const overNativeContext =
    Boolean(nativeContext) &&
    form.numCtx.trim() !== "" &&
    Number.isFinite(contextNumber) &&
    contextNumber > (nativeContext ?? 0);

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-overlay"
      role="dialog"
      onMouseDown={handleOverlayClick}
    >
      <div ref={modalRef} className="settings-modal model-settings-modal">
        <header className="settings-header model-settings-header">
          <div className="model-settings-heading">
            <span className="model-settings-icon" aria-hidden="true">
              <SlidersHorizontal size={18} />
            </span>
            <div className="model-settings-title">
              <p className="settings-eyebrow">Model settings</p>
              <h2 id={titleId} title={model}>
                {getModelDisplayName(model, 42)}
              </h2>
              <p className="model-settings-subtitle" title={model}>
                {model}
              </p>
              {meta.length > 0 ? (
                <p className="model-settings-meta">{meta.join(" · ")}</p>
              ) : null}
            </div>
          </div>
          <button
            ref={closeRef}
            aria-label="Close model settings"
            className="icon-button"
            type="button"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="settings-body">
          <div className="model-settings-note">
            <Info size={14} />
            <p>
              These overrides are sent with every request for this model and
              saved in this browser. Blank fields fall back to your app defaults
              or Ollama’s own.
            </p>
          </div>

          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>Context window</h3>
              <p>How much of the conversation the model can hold at once.</p>
            </div>

            <div className="context-input-row">
              <div
                className={classNames(
                  "model-input-wrap",
                  errors.numCtx && "has-error",
                )}
              >
                <input
                  aria-describedby="context-field-note"
                  aria-invalid={Boolean(errors.numCtx)}
                  aria-label="Context window in tokens"
                  className="model-number-input"
                  id="model-context"
                  inputMode="numeric"
                  max={ranges.numCtx.max}
                  min={ranges.numCtx.min}
                  placeholder={contextPlaceholder}
                  step={1024}
                  type="number"
                  value={form.numCtx}
                  onChange={(event) =>
                    updateField("numCtx", event.target.value)
                  }
                />
                <span className="model-input-suffix">tokens</span>
              </div>
              <button
                aria-pressed={form.numCtx === ""}
                className={classNames(
                  "context-default-button",
                  form.numCtx === "" && "is-selected",
                )}
                type="button"
                onClick={() => updateField("numCtx", "")}
              >
                Default
              </button>
            </div>

            <div className="context-presets" aria-label="Context presets">
              {contextPresets.map((value) => (
                <button
                  aria-pressed={Number(form.numCtx) === value}
                  className={classNames(
                    "context-preset",
                    Number(form.numCtx) === value && "is-selected",
                  )}
                  key={value}
                  type="button"
                  onClick={() => updateField("numCtx", String(value))}
                >
                  {value >= 1024
                    ? `${Math.round(value / 1024)}K`
                    : formatNumber(value)}
                </button>
              ))}
            </div>

            <p
              className={classNames(
                "settings-field-note",
                "context-field-note",
                overNativeContext && "is-warning",
              )}
              id="context-field-note"
            >
              {errors.numCtx ??
                (overNativeContext && nativeContext
                  ? `Above this model’s native ${formatNumber(nativeContext)} tokens. It may fail or use much more memory.`
                  : nativeContext
                    ? `This model supports up to ${formatNumber(nativeContext)} tokens natively. Larger windows use more memory.`
                    : "Larger windows use more memory and take longer to load.")}
            </p>
          </section>

          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>Sampling</h3>
              <p>Optional overrides for how tokens are chosen.</p>
            </div>

            <div className="model-field-grid">
              {specs.map((spec) => (
                <div className="model-field" key={spec.key}>
                  <label className="settings-label" htmlFor={`model-${spec.key}`}>
                    {spec.label}
                  </label>
                  <div
                    className={classNames(
                      "model-input-wrap",
                      errors[spec.key] && "has-error",
                    )}
                  >
                    <input
                      aria-describedby={`model-${spec.key}-note`}
                      aria-invalid={Boolean(errors[spec.key])}
                      className="model-number-input"
                      id={`model-${spec.key}`}
                      inputMode={spec.integer ? "numeric" : "decimal"}
                      max={spec.max}
                      min={spec.min}
                      placeholder={spec.placeholder}
                      step={spec.step}
                      type="number"
                      value={form[spec.key]}
                      onChange={(event) =>
                        updateField(spec.key, event.target.value)
                      }
                    />
                    {spec.key === "numPredict" ? (
                      <span className="model-input-suffix">tokens</span>
                    ) : null}
                  </div>
                  <p
                    className={classNames(
                      "model-field-note",
                      errors[spec.key] && "is-error",
                    )}
                    id={`model-${spec.key}-note`}
                  >
                    {errors[spec.key] ?? spec.note}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>Memory</h3>
              <p>How long Ollama keeps this model ready after a reply.</p>
            </div>
            <div className="select-row model-memory-row">
              <div>
                <label className="settings-label" htmlFor="model-keep-alive">
                  Keep model loaded
                </label>
                <p className="settings-field-note">
                  Longer keeps avoid reload delays, but hold RAM and VRAM.
                </p>
              </div>
              <select
                className="settings-select"
                id="model-keep-alive"
                value={keepAlive}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setKeepAlive(event.target.value)
                }
              >
                <option value="">Ollama default (5 min)</option>
                <option value="5m">5 minutes</option>
                <option value="15m">15 minutes</option>
                <option value="30m">30 minutes</option>
                <option value="1h">1 hour</option>
                <option value="0">Unload after reply</option>
              </select>
            </div>
          </section>
        </div>

        <footer className="settings-footer">
          <button
            aria-label="Reset model settings"
            className="button-quiet danger-text model-reset-button"
            disabled={!hasOverrides}
            title={
              hasOverrides
                ? "Remove every override for this model"
                : "This model has no overrides"
            }
            type="button"
            onClick={handleReset}
          >
            <RotateCcw size={13} />
            <span className="model-reset-label">Reset model</span>
          </button>
          <div className="settings-footer-actions">
            <button className="button-quiet" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="button-primary" type="button" onClick={handleSave}>
              Save changes
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
