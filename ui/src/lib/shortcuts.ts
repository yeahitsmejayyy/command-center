import { useEffect } from "react";

/**
 * Keyboard shortcuts for the board.
 *
 * One entry per shortcut, matched on a bare key press. Adding another is a line
 * in the caller's list — the matching, the guards, and the listener are shared,
 * so a second shortcut cannot accidentally behave differently from the first.
 */

export interface Shortcut {
  /** Matched case-insensitively against `KeyboardEvent.key`. */
  key: string;
  /** What it does. For the hint chip now, and a shortcut list later. */
  label: string;
  run: () => void;
}

/** The parts of a key press that decide whether a shortcut fires. */
export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/**
 * Somewhere the key press means a character, not a command.
 *
 * Without this, typing "n" into a task title would open a second dialog. Also
 * covers contenteditable, since a rich text field is still typing.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  // Duck-typed rather than `instanceof HTMLElement`: that check fails for
  // elements from another document (an iframe), and it drags a browser global
  // into what is otherwise a plain decision about a tag name.
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el !== "object") return false;
  if (el.isContentEditable === true) return true;

  const tag = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
  return tag === "input" || tag === "textarea" || tag === "select";
}

/**
 * Finds the shortcut a key press triggers, if any.
 *
 * Modified presses are never shortcuts: ⌘N, ctrl-N and alt-N belong to the
 * browser and the operating system, and stealing them is hostile.
 */
export function matchShortcut(shortcuts: Shortcut[], press: KeyPress): Shortcut | null {
  if (press.metaKey || press.ctrlKey || press.altKey) return null;

  return shortcuts.find((s) => s.key.toLowerCase() === press.key.toLowerCase()) ?? null;
}

/**
 * Binds shortcuts for as long as the component is mounted.
 *
 * `enabled` is how a dialog silences them: while one is open the board is not
 * what the keyboard is talking to.
 */
export function useShortcuts(shortcuts: Shortcut[], enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const shortcut = matchShortcut(shortcuts, event);
      if (!shortcut) return;

      event.preventDefault();
      shortcut.run();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, enabled]);
}
