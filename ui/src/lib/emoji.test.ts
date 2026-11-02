import { describe, expect, test } from "bun:test";
import { EMOJI_GROUPS, searchEmoji } from "./emoji.ts";

describe("the emoji set", () => {
  const all = EMOJI_GROUPS.flatMap((group) => group.entries);

  test("no emoji appears in two groups", () => {
    const chars = all.map((entry) => entry.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  test("every entry has searchable keywords", () => {
    for (const entry of all) {
      expect(entry.keywords.trim().length).toBeGreaterThan(0);
      // Lowercase, or a lowercased search term can never match it.
      expect(entry.keywords).toBe(entry.keywords.toLowerCase());
    }
  });

  test("every entry is actually an emoji", () => {
    // The server refuses anything else, so a list the server would reject is a
    // picker with dead buttons in it.
    for (const entry of all) {
      expect(entry.char).toMatch(/\p{Extended_Pictographic}|\p{Regional_Indicator}/u);
      expect(entry.char.length).toBeLessThanOrEqual(16);
    }
  });
});

describe("searching", () => {
  test("an empty term is the whole list, not an empty one", () => {
    expect(searchEmoji("")).toEqual(EMOJI_GROUPS);
    expect(searchEmoji("   ")).toEqual(EMOJI_GROUPS);
  });

  test("a term matches keywords, not just names", () => {
    const found = searchEmoji("db").flatMap((group) => group.entries.map((e) => e.char));
    expect(found).toContain("💾");
  });

  test("one word can reach more than one emoji", () => {
    const found = searchEmoji("ship").flatMap((group) => group.entries.map((e) => e.char));
    expect(found).toContain("🚀");
    expect(found).toContain("📦");
  });

  test("search is case-insensitive and ignores surrounding space", () => {
    expect(searchEmoji("  ROCKET ")).toEqual(searchEmoji("rocket"));
  });

  test("groups left with nothing are dropped, not shown empty", () => {
    for (const group of searchEmoji("rocket")) {
      expect(group.entries.length).toBeGreaterThan(0);
    }
  });

  test("pasting the emoji itself finds it", () => {
    const found = searchEmoji("🦀").flatMap((group) => group.entries.map((e) => e.char));
    expect(found).toEqual(["🦀"]);
  });

  test("a term nothing matches yields no groups", () => {
    expect(searchEmoji("zzzznope")).toEqual([]);
  });
});
