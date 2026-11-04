import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Native scrollbars stay hidden on everything that scrolls.
 *
 * The bug this guards against is invisible on the machine the board is built
 * on. macOS draws overlay scrollbars that fade out; Windows and most Linux
 * desktops draw classic ones that are always present and take layout width. A
 * new scrolling surface added here would look fine on a Mac and put a
 * permanent grey rail down the side of something on every other platform.
 *
 * So the test is not "the rule exists" — it is "nothing scrolls without it".
 */

const read = (name: string) => readFileSync(new URL(`../styles/${name}`, import.meta.url), "utf8");
const SHEETS = ["tokens.css", "app.css", "themes.css"] as const;
// Comments are stripped first: they contain braces and commas of their own,
// and a naive block match happily reads a sentence as a selector list.
const css = SHEETS.map(read).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `selector { ... }` block, paired with its declarations. */
function blocks(source: string): { selector: string; body: string }[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim().replace(/\s+/g, " "),
    body: m[2]!,
  }));
}

/**
 * Selectors that actually scroll, after the cascade.
 *
 * Resolving it matters: the export gives .cc-dialog overflow-y: auto and
 * app.css later sets overflow: hidden, so the dialog does not scroll at all.
 * Taking the first declaration at face value would demand a hide rule for a
 * surface that has nothing to hide. The sheets are concatenated in the order
 * main.tsx imports them, so the last declaration wins here as it does there.
 */
function scrollingSelectors(source: string): string[] {
  const last = new Map<string, string>();
  for (const { selector, body } of blocks(source)) {
    if (selector.startsWith("@") || selector.includes("%")) continue;
    const overflow = [...body.matchAll(/overflow(?:-y)?\s*:\s*(auto|scroll|hidden|visible|clip)/g)].pop();
    if (!overflow) continue;
    for (const one of selector.split(",")) last.set(one.trim(), overflow[1]!);
  }
  return [...last].filter(([, value]) => value === "auto" || value === "scroll").map(([s]) => s);
}

/** Selectors our hide rule applies to. */
function hiddenSelectors(source: string): Set<string> {
  const found = new Set<string>();
  for (const { selector, body } of blocks(source)) {
    if (!/scrollbar-width\s*:\s*none/.test(body)) continue;
    for (const one of selector.split(",")) found.add(one.trim());
  }
  return found;
}

describe("native scrollbars", () => {
  const hidden = hiddenSelectors(css);

  test("the hide rule exists at all", () => {
    expect(hidden.size).toBeGreaterThan(0);
  });

  test("every scrolling surface is covered", () => {
    const uncovered = scrollingSelectors(css).filter((selector) => !hidden.has(selector));
    // Named in the failure so a new surface says which one it is.
    expect(uncovered).toEqual([]);
  });

  /**
   * Our webkit rules, identified by zeroing the bar.
   *
   * The export also ships a .scroll-thin that styles ::-webkit-scrollbar to a
   * visible 9px. Nothing uses it, but it is part of the transcription and
   * stays, so these tests match on what the rule does rather than on the
   * pseudo-element alone.
   */
  const ourWebkit = blocks(css).filter(
    (b) => b.selector.includes("::-webkit-scrollbar") && /width\s*:\s*0/.test(b.body),
  );

  test("the webkit half is there too, and zero in both axes", () => {
    // scrollbar-width alone leaves Chrome, Edge and Safari drawing a bar.
    expect(ourWebkit.length).toBeGreaterThan(0);
    for (const rule of ourWebkit) {
      expect(rule.body).toMatch(/height\s*:\s*0/);
    }
  });

  test("the webkit selectors match the standard ones", () => {
    // Two lists that have to agree; letting them drift is how one surface
    // keeps its bar in Chrome and loses it in Firefox.
    const webkit = new Set(
      ourWebkit.flatMap((b) =>
        b.selector.split(",").map((s) => s.trim().replace("::-webkit-scrollbar", "")),
      ),
    );
    expect([...webkit].sort()).toEqual([...hidden].sort());
  });

  test("scrolling itself is never disabled to achieve this", () => {
    // overflow: hidden would also remove the bar, and the content with it.
    for (const selector of hidden) {
      const own = blocks(css).filter((b) => b.selector.split(",").some((s) => s.trim() === selector));
      for (const rule of own) {
        expect(rule.body).not.toMatch(/overflow(-y)?\s*:\s*hidden/);
      }
    }
  });
});
