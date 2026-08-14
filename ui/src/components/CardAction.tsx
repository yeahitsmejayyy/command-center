import { useState } from "react";
import { createPortal } from "react-dom";

/**
 * The one action a card offers without being opened.
 *
 * It occupies the corner that used to hold a status chip, stays invisible until
 * the card is hovered, and never starts a drag or opens the task — both of
 * which it sits inside and would otherwise trigger.
 *
 * The tooltip renders into <body> rather than inside the card. The column's
 * list scrolls (`overflow-y: auto`), so anything drawn above a card's top edge
 * is clipped by that scroll box — which is exactly where a tooltip wants to be.
 */
export function CardAction({
  label,
  tone,
  onAct,
  children,
}: {
  label: string;
  tone: "danger" | "warn";
  onAct: () => void;
  children: React.ReactNode;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const show = (target: HTMLElement) => {
    const r = target.getBoundingClientRect();
    // Prefer above; flip under when the card sits near the top of the viewport.
    const below = r.top < 44;
    setTip({
      x: Math.round(r.left + r.width / 2),
      y: Math.round(below ? r.bottom + 6 : r.top - 6),
      below,
    });
  };

  return (
    <span className="cc-cardaction">
      <button
        type="button"
        className={`cc-cardaction__btn cc-cardaction__btn--${tone}`}
        aria-label={label}
        // The card is a draggable and a click target; this button is neither.
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setTip(null);
          onAct();
        }}
        onPointerEnter={(e) => show(e.currentTarget)}
        onPointerLeave={() => setTip(null)}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={() => setTip(null)}
      >
        {children}
      </button>

      {tip &&
        createPortal(
          <span
            role="tooltip"
            className={`cc-tip cc-tip--${tone}${tip.below ? " cc-tip--below" : ""}`}
            style={{ left: tip.x, top: tip.y }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

export function StopIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}
