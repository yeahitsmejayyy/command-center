import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { THEMES, hasRain, parseTheme, type Theme } from "./themes.ts";

/**
 * The theme list and the stored-value guard.
 *
 * Both are small, and both are the kind of small that breaks quietly: a theme
 * whose id does not match its stylesheet block renders as the default and
 * nobody can say why, and a guard that accepts anything puts an unknown value
 * on the root element where no block claims it.
 */

describe("parseTheme", () => {
  test("accepts every theme we ship", () => {
    for (const spec of THEMES) {
      expect(parseTheme(spec.id)).toBe(spec.id);
    }
  });

  test("rejects a value no longer shipped, rather than guessing", () => {
    // The point of undefined: the caller falls back to the system preference,
    // which is what someone with a stale "sepia" in localStorage should get.
    expect(parseTheme("sepia")).toBeUndefined();
    expect(parseTheme("matrix")).toBeUndefined();
  });

  test("rejects non-strings without throwing", () => {
    // localStorage yields null when the key was never written, and the guard is
    // the first thing to see it.
    expect(parseTheme(null)).toBeUndefined();
    expect(parseTheme(undefined)).toBeUndefined();
    expect(parseTheme(0)).toBeUndefined();
    expect(parseTheme({ id: "dark" })).toBeUndefined();
  });

  test("is case-sensitive, matching the attribute selectors", () => {
    // CSS attribute selectors are case-sensitive here, so accepting "Dark"
    // would set an attribute no block matches.
    expect(parseTheme("Dark")).toBeUndefined();
  });
});

describe("THEMES", () => {
  test("ids are unique", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the two original themes keep their ids", () => {
    // These two are already in people's localStorage. Renaming either would
    // silently reset every existing board to the system preference.
    const ids = THEMES.map((t) => t.id);
    expect(ids).toContain("light");
    expect(ids).toContain("dark");
  });

  test("light is first, so it reads as the default", () => {
    expect(THEMES[0]?.id).toBe("light");
  });

  test("every theme has a label, a hint, and two swatch colours", () => {
    for (const spec of THEMES) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.hint.length).toBeGreaterThan(0);
      expect(spec.swatch).toHaveLength(2);
      for (const colour of spec.swatch) {
        expect(colour).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});

describe("hasRain", () => {
  test("only Neo rains", () => {
    const raining = THEMES.filter((t) => hasRain(t.id)).map((t) => t.id);
    expect(raining).toEqual(["neo"]);
  });

  test("the plain themes do not", () => {
    for (const theme of ["light", "dark", "cyberpunk"] satisfies Theme[]) {
      expect(hasRain(theme)).toBe(false);
    }
  });
});

/**
 * The swatches, checked against the stylesheets rather than against
 * themselves.
 *
 * A swatch is a promise about what a theme looks like, and it is made in
 * TypeScript while the theme is defined in CSS — so nothing stops the two
 * drifting apart silently. This reads the real declarations and compares.
 */
describe("swatches against the real CSS", () => {
  const css =
    readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8") +
    readFileSync(new URL("../styles/themes.css", import.meta.url), "utf8");

  function blocksMatching(selector: string): string[] {
    return [...css.matchAll(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]!);
  }

  /** Only what this theme declares for itself. */
  function blocksFor(theme: Theme): string[] {
    if (theme === "light") return blocksMatching(":root");
    return blocksMatching(`\\[data-theme="${theme}"\\]`);
  }

  /**
   * Every block that applies to this theme, in cascade order.
   *
   * :root comes first because a theme only overrides what it means to change —
   * Night keeps the brand orange by saying nothing about it, so looking only
   * at its own block would find no --primary at all.
   */
  function cascadeFor(theme: Theme): string[] {
    return theme === "light" ? blocksFor(theme) : [...blocksMatching(":root"), ...blocksFor(theme)];
  }

  /** The last declaration of `name` wins, as it would in the browser. */
  function declared(theme: Theme, name: string): string | undefined {
    let found: string | undefined;
    for (const block of cascadeFor(theme)) {
      for (const match of block.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, "g"))) {
        found = match[1]!.trim();
      }
    }
    return found;
  }

  /** One level of indirection is all the stylesheets use (--primary: var(--orange)). */
  function resolve(theme: Theme, name: string): string | undefined {
    const value = declared(theme, name);
    const indirect = value?.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    return indirect ? declared(theme, indirect[1]!) : value;
  }

  test.each(THEMES.map((spec) => [spec.id, spec] as const))(
    "%s's accent is its real --primary",
    (id, spec) => {
      expect(resolve(id, "--primary")?.toUpperCase()).toBe(spec.swatch[1].toUpperCase());
    },
  );

  test.each(THEMES.map((spec) => [spec.id, spec] as const))(
    "%s's base is a colour that theme actually declares",
    (id, spec) => {
      // Not pinned to --bg: Cyberpunk's --bg reads as pure black at 22px, so
      // its swatch shows the violet a user actually sees instead. What must
      // hold is that the colour is one of the theme's own, not an invention.
      const own = blocksFor(id)
        .join("")
        .match(/#[0-9A-Fa-f]{6}/g)
        ?.map((hex) => hex.toUpperCase()) ?? [];
      expect(own).toContain(spec.swatch[0].toUpperCase());
    },
  );

  test("no two themes share a swatch base", () => {
    // The whole point of the dot is telling them apart at a glance.
    const bases = THEMES.map((spec) => spec.swatch[0].toUpperCase());
    expect(new Set(bases).size).toBe(bases.length);
  });
});

/**
 * The rain's colours.
 *
 * It once read --primary and --ink off the document at mount, which made it
 * whatever theme happened to be in force at that instant — brand orange on a
 * cold load, cyan when switched in from Cyberpunk. The fix was to give it
 * tokens of its own that only Neo declares, plus fallbacks that are Neo's own
 * greens. These tests pin both halves of that.
 */
describe("the rain's colours", () => {
  const themesCss = readFileSync(new URL("../styles/themes.css", import.meta.url), "utf8");
  const tokensCss = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
  const rain = readFileSync(new URL("../components/MatrixRain.tsx", import.meta.url), "utf8");

  const neoBlock = themesCss.match(/\[data-theme="neo"\]\s*\{([^}]*)\}/)![1]!;

  test.each(["--rain-trail", "--rain-head"])("%s is declared in the Neo block", (name) => {
    expect(neoBlock).toContain(name);
  });

  test.each(["--rain-trail", "--rain-head"])("%s is declared nowhere else", (name) => {
    // The whole guarantee rests on this: a token no other theme declares
    // resolves to nothing elsewhere, so the fallback — green — takes over.
    const everywhere = (themesCss + tokensCss).split(`${name}:`).length - 1;
    expect(everywhere).toBe(1);
  });

  test("the canvas reads its own styles, not the document's", () => {
    // getComputedStyle(document.documentElement) is what made the colour
    // depend on when the component mounted relative to its parent.
    expect(rain).not.toContain("getComputedStyle(document.documentElement)");
    expect(rain).toContain("getComputedStyle(canvas)");
  });

  test("it reads the rain tokens, not another theme's accent", () => {
    expect(rain).toContain('getPropertyValue("--rain-trail")');
    expect(rain).toContain('getPropertyValue("--rain-head")');
    expect(rain).not.toContain('getPropertyValue("--primary")');
  });

  test("every fallback colour is one Neo itself declares", () => {
    // A fallback is only reached when the theme is not resolvable, so it has
    // to be green on its own account — not inherited from anything.
    const fallbacks = [...rain.matchAll(/getPropertyValue\("--rain-\w+"\)[^|]*\|\|\s*"(#[0-9A-Fa-f]{6})"/g)]
      .map((m) => m[1]!.toUpperCase());

    expect(fallbacks.length).toBe(2);
    const neoColours = (neoBlock.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((h) => h.toUpperCase());
    for (const fallback of fallbacks) expect(neoColours).toContain(fallback);
  });
});
