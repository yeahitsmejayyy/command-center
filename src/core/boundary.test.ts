import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The dependency rule, enforced rather than documented.
 *
 * core/ is pure: it may not reach for I/O, a clock, randomness, or any other
 * layer. A rule nobody checks is a rule that decays, so this test reads the
 * actual imports rather than trusting review to catch it.
 *
 * This file is the one exception — a boundary test has to use node:fs to read
 * the sources it is policing.
 */

const CORE_DIR = import.meta.dir;
const ALLOWED_BARE_IMPORTS = new Set(["zod"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!entry.endsWith(".ts")) return [];
    if (entry.endsWith(".test.ts")) return []; // tests may use node:fs; production code may not
    return [full];
  });
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  // static imports/re-exports, plus dynamic import()
  const patterns = [
    /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) if (m[1]) specifiers.push(m[1]);
  }
  return specifiers;
}

const FILES = sourceFiles(CORE_DIR);

describe("core stays pure", () => {
  test("finds the core sources it is meant to police", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  test("no file imports node: or bun: builtins", () => {
    for (const file of FILES) {
      for (const spec of importsOf(file)) {
        expect(`${file}: ${spec}`).not.toMatch(/^.*: (node|bun):/);
      }
    }
  });

  test("no file imports from another layer", () => {
    for (const file of FILES) {
      for (const spec of importsOf(file)) {
        const escapesCore = spec.startsWith("../");
        expect(`${file} imports ${spec}`).toBe(escapesCore ? "" : `${file} imports ${spec}`);
      }
    }
  });

  test("only allow-listed third-party packages are imported", () => {
    for (const file of FILES) {
      for (const spec of importsOf(file)) {
        const isRelative = spec.startsWith(".");
        if (isRelative) continue;
        expect(ALLOWED_BARE_IMPORTS.has(spec.split("/")[0]!)).toBe(true);
      }
    }
  });

  test("no file reaches for a clock or randomness", () => {
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/Date\.now\(|new Date\(|Math\.random\(|performance\.now\(/);
    }
  });
});
