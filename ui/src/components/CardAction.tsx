import { useTooltip } from "./Tooltip.tsx";

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
  const tip = useTooltip(label, "danger");

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
          tip.hide();
          onAct();
        }}
        {...tip.handlers}
      >
        {children}
      </button>
      {tip.node}
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
