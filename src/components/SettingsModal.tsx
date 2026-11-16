import { Check, Cpu, Moon, Sun, Trash2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import type { Settings } from "../types";
import { classNames } from "../lib/utils";
import {
  fontScaleRange,
  formatScale,
  uiScaleRange,
} from "../lib/display";

interface SettingsModalProps {
  settings: Settings;
  conversationCount: number;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onClearAll: () => void;
}

const contextOptions = [
  { value: 0, label: "Model default" },
  { value: 4096, label: "4,096 tokens" },
  { value: 8192, label: "8,192 tokens" },
  { value: 16384, label: "16,384 tokens" },
  { value: 32768, label: "32,768 tokens" },
  { value: 65536, label: "65,536 tokens" },
];

export function SettingsModal({
  settings,
  conversationCount,
  onChange,
  onClose,
  onClearAll,
}: SettingsModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

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

      if (event.shiftKey && (active === first || !modalRef.current.contains(active))) {
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

  const handleTemperature = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ temperature: Number(event.target.value) });
  };

  const handleNumCtx = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange({ numCtx: Number(event.target.value) });
  };

  const handleFontScale = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ fontScale: Number(event.target.value) });
  };

  const handleUiScale = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ uiScale: Number(event.target.value) });
  };

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-overlay"
      role="dialog"
      onMouseDown={handleOverlayClick}
    >
      <div ref={modalRef} className="settings-modal">
        <header className="settings-header">
          <div>
            <p className="settings-eyebrow">Preferences</p>
            <h2 id={titleId}>Make it yours</h2>
          </div>
          <button
            ref={closeRef}
            aria-label="Close settings"
            className="icon-button"
            type="button"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>Personality</h3>
              <p>Applied to every new message you send.</p>
            </div>
            <label className="settings-label" htmlFor="system-prompt">
              System prompt
            </label>
            <textarea
              id="system-prompt"
              className="settings-textarea"
              placeholder="You are a thoughtful, concise assistant…"
              rows={4}
              value={settings.systemPrompt}
              onChange={(event) => onChange({ systemPrompt: event.target.value })}
            />
          </section>

          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>Generation defaults</h3>
              <p>
                App-wide fallbacks. Use the sliders button beside the model
                picker to tune one model.
              </p>
            </div>

            <div className="range-row">
              <label className="settings-label" htmlFor="temperature">
                Temperature
              </label>
              <output htmlFor="temperature">
                {settings.temperature.toFixed(1)}
              </output>
            </div>
            <input
              id="temperature"
              className="range-input"
              max="2"
              min="0"
              step="0.1"
              type="range"
              value={settings.temperature}
              onChange={handleTemperature}
            />
            <div className="range-scale">
              <span>Precise</span>
              <span>Creative</span>
            </div>

            <div className="select-row">
              <div>
                <label className="settings-label" htmlFor="context-length">
                  Context window
                </label>
                <p className="settings-field-note">
                  Larger windows use more memory. Each model can override this
                  in its settings.
                </p>
              </div>
              <select
                id="context-length"
                className="settings-select"
                value={settings.numCtx}
                onChange={handleNumCtx}
              >
                {contextOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>Display</h3>
              <p>Make the interface comfortable to read on any screen.</p>
            </div>

            <div className="display-setting">
              <div className="range-row">
                <label className="settings-label" htmlFor="font-scale">
                  Text size
                </label>
                <output htmlFor="font-scale">
                  {formatScale(settings.fontScale)}
                </output>
              </div>
              <input
                id="font-scale"
                className="range-input"
                max={fontScaleRange.max}
                min={fontScaleRange.min}
                step={fontScaleRange.step}
                type="range"
                value={settings.fontScale}
                onChange={handleFontScale}
              />
              <div className="range-scale">
                <span>Smaller</span>
                <span>Larger</span>
              </div>
              <p className="settings-field-note display-note">
                Scales type only; the layout stays put.
              </p>
            </div>

            <div className="display-setting">
              <div className="range-row">
                <label className="settings-label" htmlFor="ui-scale">
                  Interface size
                </label>
                <output htmlFor="ui-scale">
                  {formatScale(settings.uiScale)}
                </output>
              </div>
              <input
                id="ui-scale"
                className="range-input"
                max={uiScaleRange.max}
                min={uiScaleRange.min}
                step={uiScaleRange.step}
                type="range"
                value={settings.uiScale}
                onChange={handleUiScale}
              />
              <div className="range-scale">
                <span>Smaller</span>
                <span>Larger</span>
              </div>
              <p className="settings-field-note display-note">
                Zooms text, controls, and spacing together. Large scales work
                best on wide screens.
              </p>
            </div>

            {settings.fontScale !== 1 || settings.uiScale !== 1 ? (
              <button
                className="display-reset"
                type="button"
                onClick={() => onChange({ fontScale: 1, uiScale: 1 })}
              >
                Reset display size
              </button>
            ) : null}
          </section>

          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>Appearance</h3>
              <p>Choose the light you like to think in.</p>
            </div>
            <div className="theme-options" role="group" aria-label="Theme">
              <button
                className={classNames(
                  "theme-option",
                  settings.theme === "light" && "is-selected",
                )}
                type="button"
                onClick={() => onChange({ theme: "light" })}
              >
                <span className="theme-preview light">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="theme-option-label">
                  <Sun size={14} />
                  Parchment
                </span>
                {settings.theme === "light" ? <Check size={14} /> : null}
              </button>
              <button
                className={classNames(
                  "theme-option",
                  settings.theme === "dark" && "is-selected",
                )}
                type="button"
                onClick={() => onChange({ theme: "dark" })}
              >
                <span className="theme-preview dark">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="theme-option-label">
                  <Moon size={14} />
                  Midnight
                </span>
                {settings.theme === "dark" ? <Check size={14} /> : null}
              </button>
            </div>
          </section>

          <section className="settings-section settings-data">
            <div className="settings-section-heading">
              <h3>Your data</h3>
              <p>
                Chats are stored only in this browser. Nothing is sent anywhere
                except your Ollama instance.
              </p>
            </div>
            {confirmingClear ? (
              <div className="clear-confirm">
                <span>
                  Delete all {conversationCount}{" "}
                  {conversationCount === 1 ? "chat" : "chats"}? This can’t be
                  undone.
                </span>
                <div>
                  <button
                    className="button-quiet"
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="button-danger"
                    type="button"
                    onClick={onClearAll}
                  >
                    Delete everything
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="button-quiet danger-text"
                disabled={conversationCount === 0}
                type="button"
                onClick={() => setConfirmingClear(true)}
              >
                <Trash2 size={15} />
                Clear all chats
              </button>
            )}
          </section>
        </div>

        <footer className="settings-footer">
          <span className="settings-about">
            <Cpu size={13} />
            Local Chat · requests go to your Ollama instance
          </span>
          <button className="button-primary" type="button" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
