#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { join } from "node:path";
import { logFor } from "../../adapters/log.ts";
import { readPrefs } from "../../adapters/prefs.ts";
import { attachSession, clearRuntime, detachSession, readRuntime } from "../../adapters/runtime.ts";
import { readState } from "../../adapters/store.ts";
import { HOOK_CONTRACT_VERSION, contractMismatchMessage } from "./contract.ts";

/**
 * Hook entry point — what Claude Code executes on session lifecycle events.
 *
 * Governing rule: **never break the session.** A task board failing is a minor
 * inconvenience; a hook that errors, hangs, or blocks startup is a broken
 * editor. Every path here exits 0, and anything the user needs to know is said
 * through injected context rather than a failure.
 */

const SERVER_READY_TIMEOUT_MS = 4_000;

interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: string;
  reason?: string;
}

async function main(argv: string[]): Promise<void> {
  const event = argv[0] ?? "";
  const declaredContract = Number.parseInt(valueOf(argv, "--contract") ?? "", 10);

  if (Number.isFinite(declaredContract) && declaredContract !== HOOK_CONTRACT_VERSION) {
    // Loud, not silent — but only SessionStart has a channel into the session,
    // so on any other event stderr is the whole story.
    const message = contractMismatchMessage(declaredContract);
    process.stderr.write(`${message}\n`);
    if (event === "session-start") emit(message);
    return;
  }

  const input = await readInput();
  const cwd = input.cwd;
  if (!cwd) return; // nothing sensible to do without a project

  switch (event) {
    case "session-start":
      return sessionStart(cwd, input);
    case "session-end":
      return sessionEnd(cwd, input);
    default:
      return; // unknown event: stay quiet, stay out of the way
  }
}

async function sessionStart(cwd: string, input: HookInput): Promise<void> {
  const prefs = await readPrefs(cwd);

  if (prefs.enabled === false) return; // skipped: say nothing, ever
  if (prefs.enabled === null) return emit(offerText());

  const record = (await readRuntime(cwd)) ?? (await launchServer(cwd));
  if (!record) {
    emit(
      "command-center could not start its board for this project. " +
        `Run \`cmc doctor\` in ${cwd} to find out why.`,
    );
    return;
  }

  // Register this session so SessionEnd knows whether anyone else is watching.
  if (input.session_id) await attachSession(cwd, input.session_id);

  emit(await announcement(cwd, record.port, input.session_id));
}

async function sessionEnd(cwd: string, input: HookInput): Promise<void> {
  const record = await readRuntime(cwd);
  if (!record) return;

  // Several Claude sessions can share one project. Only the last one out turns
  // the lights off; otherwise closing one window kills the other's board.
  if (input.session_id) {
    const { remaining } = await detachSession(cwd, input.session_id);
    if (remaining > 0) return;
  }

  try {
    process.kill(record.pid, "SIGTERM");
  } catch {
    await clearRuntime(cwd); // process already gone; tidy the record
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

async function launchServer(cwd: string) {
  const log = logFor(cwd);
  const entry = join(import.meta.dir, "..", "cli", "main.ts");

  try {
    // Detached and fully disconnected: the server must outlive this hook, and
    // an inherited stdio pipe would keep Claude Code waiting on it.
    const child = spawn(process.execPath, ["run", entry, "server", "--cwd", cwd], {
      cwd,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
  } catch (err) {
    await log.error("could not spawn the server", { error: String(err) });
    return null;
  }

  // The server publishes its runtime record only once it is listening, so
  // waiting for the record is the same as waiting for a live port.
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const record = await readRuntime(cwd);
    if (record) return record;
    await Bun.sleep(60);
  }

  await log.error("the server did not report a port in time");
  return null;
}

// ---------------------------------------------------------------------------
// What Claude is told
// ---------------------------------------------------------------------------

function offerText(): string {
  return [
    "command-center is installed but not set up for this project.",
    "",
    "Tell the user they can run `/command-center:enable` to open a task board for this project,",
    "or `/command-center:skip` to leave this project alone. Ask once, then respect the answer.",
  ].join("\n");
}

async function announcement(cwd: string, port: number, sessionId?: string): Promise<string> {
  const lines = [
    `command-center is running for this project at http://127.0.0.1:${port}`,
    "",
  ];

  try {
    const state = await readState(cwd);
    const queued = state.tasks.filter((t) => t.status === "queued").length;
    const active = state.tasks.find((t) => t.status === "in-progress");
    const review = state.tasks.filter((t) => t.status === "awaiting-review").length;

    if (active) {
      lines.push(
        `"${active.title}" is currently in progress. Run \`cmc finish\` when the work is done,`,
        "then `/command-center:start` to pick up the next task.",
      );
    } else if (queued > 0) {
      lines.push(
        `${queued} task(s) are queued. Run \`/command-center:start\` when the user is ready to begin.`,
      );
    } else {
      lines.push("Nothing is queued. The user can add tasks on the board.");
    }

    if (review > 0) {
      lines.push(`${review} task(s) are awaiting review.`);
    }
  } catch {
    lines.push("The board is available, but its saved state could not be read. Try `cmc doctor`.");
  }

  if (sessionId) lines.push("", `Session: ${sessionId}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Claude Code plumbing
// ---------------------------------------------------------------------------

/** Verified against Claude Code 2.1.229 — see docs/plugin-platform.md. */
function emit(additionalContext: string): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
    })}\n`,
  );
}

async function readInput(): Promise<HookInput> {
  try {
    const text = await new Response(Bun.stdin.stream()).text();
    return text.trim() ? (JSON.parse(text) as HookInput) : {};
  } catch {
    return {}; // unparseable stdin must not take the session down
  }
}

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

try {
  await main(process.argv.slice(2));
} catch {
  // Last line of defence: a hook must never fail a session.
}
process.exit(0);
