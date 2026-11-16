import { X } from "lucide-react";
import type { ToastState } from "../types";

interface ToastProps {
  toast: ToastState;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{toast.message}</span>
      {toast.actionLabel && toast.onAction ? (
        <button
          className="toast-action"
          type="button"
          onClick={() => {
            toast.onAction?.();
            onDismiss();
          }}
        >
          {toast.actionLabel}
        </button>
      ) : null}
      <button
        aria-label="Dismiss notification"
        className="toast-close"
        type="button"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
