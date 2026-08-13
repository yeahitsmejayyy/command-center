import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setEnabled } from "../../adapters/prefs.ts";
import { readRuntime } from "../../adapters/runtime.ts";
import { HOOK_CONTRACT_VERSION } from "./contract.ts";

/**
 * The hook is what Claude Code actually executes. These tests spawn it exactly
 * the way the plugin does — real process, JSON on stdin, JSON on stdout.
 */

const HOOK = join(import.meta.dir, "main.ts");
const CLI = join(import.meta.dir, "..", "cli", "main.ts");
let home: string;
let project: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cc-hook-home-"));
  project = mkdtempSync(join(tmpdir(), "cc-hook-proj-"));
  process.env.COMMAND_CENTER_HOME = home;
});

afterEach(async () => {
  // Any server a hook started belongs to this test only.
  const record = await readRuntime(project);
  if (record) {
    try {
      process.kill(record.pid);
    } catch {
      /* already gone */
    }
  }
  delete process.env.COMMAND_CENTER_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

async function runHook(event: string, extra: string[] = [], stdin?: object) {
  const proc = Bun.spawn(["bun", "run", HOOK, event, ...extra], {
    env: { ...process.env, COMMAND_CENTER_HOME: home },
    stdin: new TextEncoder().encode(
      JSON.stringify(stdin ?? { session_id: "s1", cwd: project, hook_event_name: "SessionStart", source: "startup" }),
    ),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, code: await proc.exited };
}

function contextOf(stdout: string): string {
  if (!stdout.trim()) return "";
  const parsed = JSON.parse(stdout);
  return parsed.hookSpecificOutput?.additionalContext ?? "";
}

const CONTRACT = [`--contract`, String(HOOK_CONTRACT_VERSION)];

function sessionInput(sessionId: string) {
  return { session_id: sessionId, cwd: project, hook_event_name: "SessionStart", source: "startup" };
}

function endInput(sessionId: string) {
  return { session_id: sessionId, cwd: project, hook_event_name: "SessionEnd", reason: "other" };
}

describe("contract version", () => {
  test("accepts the version the plugin declares", async () => {
    const r = await runHook("session-start", CONTRACT);

    expect(r.code).toBe(0);
  });

  test("a mismatch is explicit, never a silent no-op", async () => {
    const r = await runHook("session-start", ["--contract", "99"]);

    const said = r.stdout + r.stderr;
    expect(said).toContain("99");
    expect(said).toContain(String(HOOK_CONTRACT_VERSION));
    expect(said.toLowerCase()).toMatch(/update|reinstall|mismatch/);
  });

  test("a mismatch still exits 0 so the session is never blocked", async () => {
    const r = await runHook("session-start", ["--contract", "99"]);

    expect(r.code).toBe(0);
  });
});

describe("session-start — undecided project", () => {
  test("offers the choice", async () => {
    const context = contextOf((await runHook("session-start", CONTRACT)).stdout);

    expect(context).toContain("/command-center:enable");
    expect(context).toContain("/command-center:skip");
  });

  test("starts no server before being asked", async () => {
    await runHook("session-start", CONTRACT);

    expect(await readRuntime(project)).toBeNull();
  });
});

describe("session-start — skipped project", () => {
  test("says nothing at all", async () => {
    await setEnabled(project, false);

    const r = await runHook("session-start", CONTRACT);
    expect(contextOf(r.stdout)).toBe("");
  });

  test("starts no server", async () => {
    await setEnabled(project, false);
    await runHook("session-start", CONTRACT);

    expect(await readRuntime(project)).toBeNull();
  });
});

describe("session-start — enabled project", () => {
  test("starts the board and announces its URL", async () => {
    await setEnabled(project, true);

    const context = contextOf((await runHook("session-start", CONTRACT)).stdout);
    const record = await readRuntime(project);

    expect(record).not.toBeNull();
    expect(context).toContain(`http://127.0.0.1:${record!.port}`);
  });

  test("the announced server actually answers", async () => {
    await setEnabled(project, true);
    await runHook("session-start", CONTRACT);

    const record = await readRuntime(project);
    const res = await fetch(`http://127.0.0.1:${record!.port}/api/version`);
    expect(res.status).toBe(200);
  });

  test("reuses a server that is already running", async () => {
    await setEnabled(project, true);
    await runHook("session-start", CONTRACT);
    const first = await readRuntime(project);

    await runHook("session-start", CONTRACT);
    const second = await readRuntime(project);

    expect(second!.pid).toBe(first!.pid);
    expect(second!.port).toBe(first!.port);
  });

  test("mentions queued work so Claude knows there is something to do", async () => {
    await setEnabled(project, true);
    await Bun.spawn(["bun", "run", CLI, "--cwd", project, "add", "Queued task", "--queued"], {
      env: { ...process.env, COMMAND_CENTER_HOME: home },
    }).exited;

    const context = contextOf((await runHook("session-start", CONTRACT)).stdout);
    expect(context).toContain("/command-center:start");
  });
});

describe("robustness", () => {
  test("malformed stdin does not block the session", async () => {
    const proc = Bun.spawn(["bun", "run", HOOK, "session-start", ...CONTRACT], {
      env: { ...process.env, COMMAND_CENTER_HOME: home },
      stdin: new TextEncoder().encode("{ not json"),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
  });

  test("an unknown event exits 0 rather than failing the session", async () => {
    expect((await runHook("not-a-real-event", CONTRACT)).code).toBe(0);
  });

  test("output is either empty or a single valid JSON object", async () => {
    await setEnabled(project, true);
    const r = await runHook("session-start", CONTRACT);

    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});

describe("multiple sessions on one project", () => {
  /**
   * Two Claude windows open on the same project. Closing one must not take the
   * board away from the other — the bug this whole mechanism exists to prevent.
   */
  test("the board survives one session ending while another is open", async () => {
    await setEnabled(project, true);
    await runHook("session-start", CONTRACT, sessionInput("s1"));
    await runHook("session-start", CONTRACT, sessionInput("s2"));

    const before = await readRuntime(project);
    expect(before!.sessionIds.sort()).toEqual(["s1", "s2"]);

    await runHook("session-end", CONTRACT, endInput("s1"));
    await Bun.sleep(300);

    const after = await readRuntime(project);
    expect(after).not.toBeNull();
    expect(after!.pid).toBe(before!.pid);
    expect(after!.sessionIds).toEqual(["s2"]);
  });

  test("the board stops once the last session ends", async () => {
    await setEnabled(project, true);
    await runHook("session-start", CONTRACT, sessionInput("s1"));
    await runHook("session-start", CONTRACT, sessionInput("s2"));

    await runHook("session-end", CONTRACT, endInput("s1"));
    await runHook("session-end", CONTRACT, endInput("s2"));

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (await readRuntime(project)) !== null) {
      await Bun.sleep(50);
    }
    expect(await readRuntime(project)).toBeNull();
  });

  test("a session that starts is registered against the server", async () => {
    await setEnabled(project, true);
    await runHook("session-start", CONTRACT, sessionInput("only-one"));

    expect((await readRuntime(project))?.sessionIds).toEqual(["only-one"]);
  });
});

describe("output names the event it is answering", () => {
  test("session-start output is tagged SessionStart", async () => {
    await setEnabled(project, true);
    const parsed = JSON.parse((await runHook("session-start", CONTRACT)).stdout);

    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
  });

  test("session-end says nothing at all — it has no context to inject", async () => {
    await setEnabled(project, true);
    await runHook("session-start", CONTRACT, sessionInput("s1"));

    const r = await runHook("session-end", CONTRACT, endInput("s1"));
    expect(r.stdout.trim()).toBe("");
  });

  test("a contract mismatch on session-end stays silent on stdout", async () => {
    const r = await runHook("session-end", ["--contract", "99"], endInput("s1"));

    expect(r.stdout.trim()).toBe("");
    expect(r.stderr).toContain("99"); // still reported where an operator can see it
  });
});

describe("session-end", () => {
  test("stops the server it started", async () => {
    await setEnabled(project, true);
    await runHook("session-start", CONTRACT);
    expect(await readRuntime(project)).not.toBeNull();

    await runHook("session-end", CONTRACT, {
      session_id: "s1", cwd: project, hook_event_name: "SessionEnd", reason: "other",
    });

    // Give the signal a moment to land.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (await readRuntime(project)) !== null) {
      await Bun.sleep(50);
    }
    expect(await readRuntime(project)).toBeNull();
  });

  test("is harmless when no server is running", async () => {
    const r = await runHook("session-end", CONTRACT, {
      session_id: "s1", cwd: project, hook_event_name: "SessionEnd", reason: "other",
    });

    expect(r.code).toBe(0);
  });
});
