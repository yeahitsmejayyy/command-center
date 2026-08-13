import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The shim is the plugin's entire executable surface, and its two callers need
 * opposite things from a failure. These tests run it as a real process with a
 * stripped environment, because that is exactly the situation it exists for:
 * a hook whose PATH does not include the user's Bun.
 */

const ROOT = join(import.meta.dir, "..", "..");
const SHIM = join(ROOT, "bin", "cmc");

/** A PATH with no Bun on it, and a HOME with no ~/.bun to fall back to. */
const WITHOUT_BUN = { PATH: "/usr/bin:/bin", HOME: "/nonexistent", BUN_INSTALL: "/nonexistent" };

async function runShim(args: string[], env: Record<string, string>, stdin = "{}") {
  const proc = Bun.spawn([SHIM, ...args], {
    env,
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, code: await proc.exited };
}

describe("missing Bun — CLI mode", () => {
  test("fails honestly with a non-zero exit code", async () => {
    const r = await runShim(["list"], WITHOUT_BUN);

    expect(r.code).not.toBe(0);
  });

  test("names Bun and gives the exact install command", async () => {
    const r = await runShim(["list"], WITHOUT_BUN);

    expect(r.stderr).toContain("Bun");
    expect(r.stderr).toContain("https://bun.sh/install");
  });

  test("says nothing on stdout — a human is reading stderr", async () => {
    const r = await runShim(["list"], WITHOUT_BUN);

    expect(r.stdout.trim()).toBe("");
  });
});

describe("missing Bun — hook mode", () => {
  test("exits 0 so the session is never broken", async () => {
    const r = await runShim(["hook", "session-start", "--contract", "1"], WITHOUT_BUN);

    expect(r.code).toBe(0);
  });

  test("explains itself inside the session", async () => {
    const r = await runShim(["hook", "session-start", "--contract", "1"], WITHOUT_BUN);
    const context = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;

    expect(context).toContain("Bun");
    expect(context).toContain("https://bun.sh/install");
  });

  test("emits exactly one valid JSON object on stdout", async () => {
    const r = await runShim(["hook", "session-start", "--contract", "1"], WITHOUT_BUN);

    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(JSON.parse(r.stdout).hookSpecificOutput.hookEventName).toBe("SessionStart");
  });

  test("stays silent on stdout for events that cannot inject context", async () => {
    const r = await runShim(["hook", "session-end", "--contract", "1"], WITHOUT_BUN);

    expect(r.stdout.trim()).toBe("");
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("Bun"); // still visible to an operator
  });
});

describe("the shim is shippable", () => {
  test("is executable — a lost exec bit means the hook silently never runs", () => {
    expect(statSync(SHIM).mode & 0o111).toBeGreaterThan(0);
  });

  test("is the only executable in bin/", () => {
    const executables = readdirSync(join(ROOT, "bin")).filter(
      (f) => statSync(join(ROOT, "bin", f)).mode & 0o111,
    );
    expect(executables).toEqual(["cmc"]);
  });
});

describe("nothing reaches the network at runtime", () => {
  /**
   * ADR-001 removed the binary download, so an installed plugin should never
   * need the network again. This greps the shipped source rather than trying
   * to sandbox a process: an outbound call would have to appear here first.
   */
  test("no source file makes an outbound request", () => {
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;

        const src = readFileSync(full, "utf8");
        // Loopback is fine — that is the board talking to itself.
        for (const match of src.matchAll(/\bfetch\s*\(\s*[`"']([^`"']*)/g)) {
          const url = match[1] ?? "";
          if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
            offenders.push(`${full}: fetch(${url || "…"})`);
          }
        }
      }
    };
    walk(join(ROOT, "src"));

    expect(offenders).toEqual([]);
  });

  test("declares exactly one runtime dependency", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };

    // Every runtime dependency is something that has to be installed on a
    // user's machine before the plugin works. Keep the count honest.
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["zod"]);
  });
});
