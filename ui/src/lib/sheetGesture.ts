import { useRef, useState } from "react";

/**
 * Swipe-to-dismiss for the bottom sheet.
 *
 * The sheet follows the finger while it is dragged down, and on release either
 * springs back or continues off-screen. A flick should dismiss even if it
 * barely moved, which is why velocity counts as well as distance — judging on
 * distance alone makes a sheet feel stuck to a quick gesture.
 */

/** How far down the sheet must travel before a slow drag dismisses it. */
const DISTANCE_THRESHOLD = 0.28;
/** Pixels per millisecond past which a flick dismisses regardless of distance. */
const VELOCITY_THRESHOLD = 0.5;

export function shouldDismiss(
  /** Distance dragged downward, in pixels. */
  distance: number,
  /** Time the drag took, in milliseconds. */
  elapsed: number,
  /** The sheet's height, in pixels. */
  height: number,
): boolean {
  if (distance <= 0) return false;
  if (height > 0 && distance >= height * DISTANCE_THRESHOLD) return true;

  const velocity = elapsed > 0 ? distance / elapsed : 0;
  return velocity >= VELOCITY_THRESHOLD;
}

/** Downward only: dragging up should not lift the sheet off its own edge. */
export function dragOffset(startY: number, currentY: number): number {
  return Math.max(0, currentY - startY);
}

export interface SheetGesture {
  /** Spread onto the part of the sheet that should respond to a drag. */
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  };
  /** Spread onto the sheet itself. */
  style: React.CSSProperties;
}

export function useSheetGesture(onDismiss: () => void, enabled: boolean): SheetGesture {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef({ y: 0, at: 0, height: 0 });

  const reset = () => {
    setDragging(false);
    setOffset(0);
  };

  return {
    handleProps: {
      onPointerDown: (e) => {
        if (!enabled) return;
        const sheet = e.currentTarget.closest(".cc-dialog") as HTMLElement | null;
        start.current = { y: e.clientY, at: Date.now(), height: sheet?.offsetHeight ?? 0 };
        setDragging(true);
        // Keeps the events coming even if the finger leaves the grabber. Not
        // every pointer can be captured, and a throw here would abandon the
        // gesture before it began.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* the drag still works, it just ends if the pointer leaves */
        }
      },
      onPointerMove: (e) => {
        if (!dragging) return;
        setOffset(dragOffset(start.current.y, e.clientY));
      },
      onPointerUp: (e) => {
        if (!dragging) return;
        try {
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        } catch {
          /* nothing was captured */
        }

        const distance = dragOffset(start.current.y, e.clientY);
        const elapsed = Date.now() - start.current.at;
        if (shouldDismiss(distance, elapsed, start.current.height)) {
          // Dismiss straight away rather than animating out on a timer: the
          // deferred unmount left the sheet slid off-screen but still mounted,
          // and a close that sometimes does not close is worse than one
          // without a flourish. The overlay fade covers the exit.
          setDragging(false);
          onDismiss();
          return;
        }
        reset();
      },
      onPointerCancel: reset,
    },
    style: {
      transform: offset ? `translateY(${offset}px)` : undefined,
      // No transition while the finger is down: the sheet should track it
      // exactly, and easing would make it feel like it is lagging behind.
      transition: dragging ? "none" : "transform 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      // Suppress the entry animation once the user has taken hold of the sheet.
      animation: dragging ? "none" : undefined,
    },
  };
}
