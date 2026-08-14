import { describe, expect, test } from "bun:test";
import { isTypingTarget, matchShortcut, type Shortcut } from "./shortcuts.ts";

/**
 * The guards are the interesting part of a shortcut: firing is easy, and not
 * firing while someone is typing is what keeps it from being infuriating.
 */

const press = (key: string, mods: Partial<Omit<Parameters<typeof matchShortcut>[1], "key">> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

const shortcuts: Shortcut[] = [
  { key: "n", label: "New task", run: () => {} },
  { key: "?", label: "Help", run: () => {} },
];

describe("matchShortcut", () => {
  test("matches a bare key press", () => {
    expect(matchShortcut(shortcuts, press("n"))?.label).toBe("New task");
  });

  test("matches regardless of case, so shift-n still works", () => {
    expect(matchShortcut(shortcuts, press("N"))?.label).toBe("New task");
  });

  test("ignores an unmapped key", () => {
    expect(matchShortcut(shortcuts, press("q"))).toBeNull();
  });

  /**
   * ⌘N opens a browser window and ctrl-N belongs to the OS. A board that
   * swallowed them would be actively hostile.
   */
  test("never fires when a modifier is held", () => {
    expect(matchShortcut(shortcuts, press("n", { metaKey: true }))).toBeNull();
    expect(matchShortcut(shortcuts, press("n", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(shortcuts, press("n", { altKey: true }))).toBeNull();
  });

  test("shift alone is not a modifier — it is how you type ?", () => {
    expect(matchShortcut(shortcuts, press("?"))?.label).toBe("Help");
  });

  test("an empty registry matches nothing", () => {
    expect(matchShortcut([], press("n"))).toBeNull();
  });
});

describe("isTypingTarget", () => {
  /** Stands in for an element; the check reads tagName, not a DOM class. */
  const el = (tagName: string, extra: Record<string, unknown> = {}) =>
    ({ tagName, ...extra }) as unknown as EventTarget;

  test("a text input is typing", () => {
    expect(isTypingTarget(el("INPUT"))).toBe(true);
  });

  test("a textarea is typing", () => {
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
  });

  test("a select is typing — letter keys jump between options", () => {
    expect(isTypingTarget(el("SELECT"))).toBe(true);
  });

  test("a contenteditable region is typing", () => {
    expect(isTypingTarget(el("DIV", { isContentEditable: true }))).toBe(true);
  });

  test("a button is not typing", () => {
    expect(isTypingTarget(el("BUTTON"))).toBe(false);
  });

  test("a card is not typing", () => {
    expect(isTypingTarget(el("ARTICLE"))).toBe(false);
  });

  test("nothing at all is not typing", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});
