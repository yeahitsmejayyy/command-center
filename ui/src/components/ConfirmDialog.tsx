import { useEffect } from "react";

/** A single destructive question, asked plainly. */
export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  detail?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="cc-overlay cc-overlay--top" onMouseDown={onCancel}>
      <div
        className="cc-dialog cc-dialog--sm"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cc-dialog__body">
          <div className="cc-dialog__title">{title}</div>
          {detail && (
            <div style={{ font: "var(--type-body-sm)", color: "var(--ink-2)" }}>{detail}</div>
          )}
        </div>
        <div className="cc-dialog__foot">
          <div className="cc-dialog__spacer" />
          <button type="button" className="cc-btn cc-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="cc-btn cc-btn--danger" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
