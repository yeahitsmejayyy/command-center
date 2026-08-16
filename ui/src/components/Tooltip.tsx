import { useState } from "react";
import { createPortal } from "react-dom";

/**
 * A tooltip that cannot be clipped.
 *
 * Both places that need one sit inside a box with `overflow: hidden` — the
 * column list scrolls, and dialogs hide overflow so their header and footer can
 * stay put. Anything drawn beyond those bounds disappears, which is exactly
 * where a tooltip wants to be. So it renders into <body> and positions itself
 * in viewport coordinates.
 *
 * Returned as handlers plus a node rather than a wrapper component, so it can
 * attach to a button or a plain span without either growing extra markup.
 */
export type TooltipTone = "neutral" | "danger";

export function useTooltip(label: string, tone: TooltipTone = "neutral") {
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const show = (target: HTMLElement) => {
    const r = target.getBoundingClientRect();
    // Prefer above; flip below when there is no room, so it is never off-screen.
    const below = r.top < 44;
    setAt({
      x: Math.round(r.left + r.width / 2),
      y: Math.round(below ? r.bottom + 6 : r.top - 6),
      below,
    });
  };

  const hide = () => setAt(null);

  return {
    handlers: {
      onPointerEnter: (e: React.PointerEvent<HTMLElement>) => show(e.currentTarget),
      onPointerLeave: hide,
      onFocus: (e: React.FocusEvent<HTMLElement>) => show(e.currentTarget),
      onBlur: hide,
    },
    hide,
    node:
      at &&
      createPortal(
        <span
          role="tooltip"
          className={`cc-tip cc-tip--${tone}${at.below ? " cc-tip--below" : ""}`}
          style={{ left: at.x, top: at.y }}
        >
          {label}
        </span>,
        document.body,
      ),
  };
}
