import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Adapters may depend on core. They may never depend on a surface.
 *
 * This is the direction rule that keeps I/O reusable across the CLI, the hook
 * entry points, and the server: the moment an adapter reaches back into a
 * surface, that adapter belongs to that surface and the other two inherit it.
 */

const ADAPTERS_DIR = import.meta.dir;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) return [];
    return [full];
  });
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const re of [
    /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const m of src.matchAll(re)) if (m[1]) specifiers.push(m[1]);
  }
  return specifiers;
}

const FILES = sourceFiles(ADAPTERS_DIR);

describe("adapters respect the dependency direction", () => {
  test("finds the adapter sources it is meant to police", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  test("no adapter imports from a surface", () => {
    for (const file of FILES) {
      for (const spec of importsOf(file)) {
        expect(`${file} imports ${spec}`).not.toContain("surfaces");
      }
    }
  });

  test("adapters only reach outside their layer to import core", () => {
    for (const file of FILES) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith("../")) continue;
        expect(spec.startsWith("../core/")).toBe(true);
      }
    }
  });
});
