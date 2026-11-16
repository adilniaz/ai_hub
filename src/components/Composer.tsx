import {
  AlertCircle,
  ArrowUp,
  ImagePlus,
  LoaderCircle,
  Paperclip,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { AttachmentImage } from "../types";
import { classNames, prepareImage, uid } from "../lib/utils";

const MAX_IMAGES = 4;

interface ComposerProps {
  text: string;
  setText: (value: string) => void;
  images: AttachmentImage[];
  setImages: (updater: (current: AttachmentImage[]) => AttachmentImage[]) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  model: string | null;
  supportsVision: boolean;
  isStreaming: boolean;
  disabled: boolean;
  onSend: (input: { text: string; images: string[] }) => void;
  onStop: () => void;
}

export function Composer({
  text,
  setText,
  images,
  setImages,
  textareaRef,
  model,
  supportsVision,
  isStreaming,
  disabled,
  onSend,
  onStop,
}: ComposerProps) {
  const [fileError, setFileError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const canSend =
    !disabled && !isStreaming && (text.trim().length > 0 || images.length > 0);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 28), 180)}px`;
  }, [text, textareaRef]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [textareaRef]);

  const addFiles = async (files: File[]) => {
    setFileError(null);
    if (files.length === 0 || preparing) return;

    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) {
      setFileError(`You can attach up to ${MAX_IMAGES} images.`);
      return;
    }

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setFileError("Only image files can be attached.");
      return;
    }

    if (imageFiles.length > remainingSlots) {
      setFileError(`You can attach up to ${MAX_IMAGES} images per message.`);
    }

    const selected = imageFiles.slice(0, remainingSlots);
    setPreparing(true);
    try {
      const prepared = await Promise.all(
        selected.map(async (file) => ({
          id: uid(),
          name: file.name,
          dataUrl: await prepareImage(file),
        })),
      );
      setImages((current) => [...current, ...prepared].slice(0, MAX_IMAGES));
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "Could not attach that image.",
      );
    } finally {
      setPreparing(false);
    }
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void addFiles(files);
  };

  const handlePaste = (event: ClipboardEvent<HTMLFormElement>) => {
    const pastedFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (pastedFiles.length > 0) {
      event.preventDefault();
      void addFiles(pastedFiles);
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    if (event.dataTransfer.types.includes("Files")) setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;
    setFileError(null);
    onSend({
      text: text.trim(),
      images: images.map((image) => image.dataUrl),
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      if (event.nativeEvent.isComposing || !canSend) return;
      event.preventDefault();
      setFileError(null);
      onSend({
        text: text.trim(),
        images: images.map((image) => image.dataUrl),
      });
    }
  };

  return (
    <div className="composer-region">
      <form
        className={classNames(
          "composer",
          disabled && "is-disabled",
          dragging && "is-dragging",
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPaste={handlePaste}
        onSubmit={handleSubmit}
      >
        {dragging ? (
          <div className="drop-overlay">
            <ImagePlus size={22} />
            <span>Drop images to attach</span>
          </div>
        ) : null}

        {images.length > 0 ? (
          <div className="attachment-list">
            {images.map((image) => (
              <div className="attachment" key={image.id}>
                <img alt={image.name} src={image.dataUrl} />
                <button
                  aria-label={`Remove ${image.name}`}
                  className="attachment-remove"
                  type="button"
                  onClick={() =>
                    setImages((current) =>
                      current.filter((item) => item.id !== image.id),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {!supportsVision ? (
              <span className="vision-warning">
                Selected model may not support images
              </span>
            ) : null}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          aria-label="Message"
          className="composer-input"
          disabled={disabled && !isStreaming}
          placeholder={
            disabled
              ? "Connect to Ollama to start chatting…"
              : "Ask anything…"
          }
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        {fileError ? (
          <div className="composer-error" role="alert">
            <AlertCircle size={13} />
            <span>{fileError}</span>
            <button
              aria-label="Dismiss error"
              type="button"
              onClick={() => setFileError(null)}
            >
              <X size={12} />
            </button>
          </div>
        ) : null}

        <div className="composer-toolbar">
          <div className="composer-tools">
            <input
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="visually-hidden"
              multiple
              type="file"
              onChange={handleFiles}
            />
            <button
              aria-label="Attach images"
              className="tool-button"
              disabled={disabled || preparing || images.length >= MAX_IMAGES}
              title={
                images.length >= MAX_IMAGES
                  ? `Maximum ${MAX_IMAGES} images`
                  : "Attach images"
              }
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              {preparing ? (
                <LoaderCircle className="is-spinning" size={17} />
              ) : (
                <Paperclip size={17} />
              )}
            </button>
            {model ? (
              <span className="composer-model-label">
                {supportsVision ? "Vision ready" : "Text mode"}
              </span>
            ) : null}
          </div>

          <div className="composer-send-group">
            <span className="composer-hint">
              <kbd>Enter</kbd> to send
            </span>
            {isStreaming ? (
              <button
                aria-label="Stop generating"
                className="send-button stop"
                title="Stop generating"
                type="button"
                onClick={onStop}
              >
                <Square fill="currentColor" size={13} />
              </button>
            ) : (
              <button
                aria-label="Send message"
                className="send-button"
                disabled={!canSend}
                title="Send message"
                type="submit"
              >
                <ArrowUp size={18} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </form>
      <p className="composer-note">
        <ShieldCheck size={12} />
        Private by design. Model output can be inaccurate.
      </p>
    </div>
  );
}
