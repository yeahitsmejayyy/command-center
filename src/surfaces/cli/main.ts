#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { mutate } from "../../adapters/mutate.ts";
import { attachSession, clearRuntime, readRuntime } from "../../adapters/runtime.ts";
import { setEnabled } from "../../adapters/prefs.ts";
import { readState } from "../../adapters/store.ts";
import { startServer } from "../server/index.ts";
import { TaskStatusSchema, type Event, type ProjectState, type Task } from "../../core/types.ts";
import { flagBool, flagString, parseArgs, type Args } from "./args.ts";
import { runDiagnostics, renderDiagnostics } from "./doctor.ts";
import { renderBoard, renderTaskForClaude } from "./render.ts";

/**
 * The CLI surface: arguments in, one core event out, adapter persists it.
 *
 * There is no business logic here. Which task `advance` picks, whether `finish`
 * is legal — those are core's decisions. This file resolves a task reference,
 * builds an event, and turns the result into words and an exit code.
 */

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE = `command-center — per-project task queue for Claude Code

Usage: cmc <command> [options]

Tasks
  add <title>          Add a task     [--body <text>] [--plan] [--queued]
  list                 Show the board [--json]
  move <task> <status> Move a task to backlog|queued|in-progress|awaiting-review|done|skipped

Working the queue
  advance              Start the next queued task and print it
  finish               Send the running task to review
  approve              Accept the task under review
  revise               Send the task under review back for more work

This project
  enable               Use command-center here, and start the board
  skip                 Leave this project alone

Serving
  server               Run the board server for this project (blocks)

Maintenance
  doctor               Diagnose problems and how to fix them [--json]
  cleanup              Stop an unused board server and clear stale records [--force]

Options
  --cwd <path>         Project directory (defaults to the current one)
`;

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.command === null) {
    if (flagBool(args, "help") || flagBool(args, "version")) return info(args);
    process.stdout.write(USAGE);
    return EXIT_USAGE;
  }
  if (args.command === "help" || flagBool(args, "help")) {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  const cwd = flagString(args, "cwd") ?? process.cwd();

  switch (args.command) {
    case "add":
      return addTask(cwd, args);
    case "list":
      return listBoard(cwd, args);
    case "move":
      return moveTask(cwd, args);
    case "advance":
      return runEvent(cwd, { type: "advance", at: now(), sessionId: flagString(args, "session") ?? null });
    case "finish":
      return runEvent(cwd, { type: "finish", at: now() });
    case "approve":
      return runEvent(cwd, { type: "approve", at: now() });
    case "revise":
      return runEvent(cwd, { type: "revise", at: now() });
    case "enable":
      return enableProject(cwd);
    case "skip":
      return skipProject(cwd);
    case "server":
      return serve(cwd);
    case "doctor":
      return doctor(cwd, args);
    case "cleanup":
      return cleanup(cwd, args);
    case "attach-session":
      return attachSessionCmd(cwd, args);
    default:
      fail(`Unknown command "${args.command}".`, "Run `cmc --help` to see the available commands.");
      return EXIT_USAGE;
  }
}

function info(args: Args): number {
  if (flagBool(args, "version")) {
    process.stdout.write("command-center 2.0.0-dev\n");
    return EXIT_OK;
  }
  process.stdout.write(USAGE);
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function addTask(cwd: string, args: Args): Promise<number> {
  const title = args.positional.join(" ").trim();
  if (!title) {
    fail("A title is required.", 'Try: cmc add "Fix the login bug"');
    return EXIT_USAGE;
  }

  return runEvent(cwd, {
    type: "create",
    at: now(),
    id: newTaskId(),
    title,
    body: flagString(args, "body") ?? "",
    planMode: flagBool(args, "plan"),
    status: flagBool(args, "queued") ? "queued" : "backlog",
  });
}

async function listBoard(cwd: string, args: Args): Promise<number> {
  const state = await readState(cwd);

  if (flagBool(args, "json")) {
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return EXIT_OK;
  }

  process.stdout.write(`${renderBoard(state)}\n`);
  return EXIT_OK;
}

async function moveTask(cwd: string, args: Args): Promise<number> {
  const [ref, target] = args.positional;
  if (!ref || !target) {
    fail("move needs a task and a status.", "Try: cmc move a1b2c3 queued");
    return EXIT_USAGE;
  }

  const status = TaskStatusSchema.safeParse(target);
  if (!status.success) {
    fail(
      `"${target}" is not a status.`,
      `Valid statuses: ${TaskStatusSchema.options.join(", ")}`,
    );
    return EXIT_FAILED;
  }

  const state = await readState(cwd);
  const resolved = resolveTask(state, ref);
  if ("error" in resolved) {
    fail(resolved.error, resolved.hint);
    return EXIT_FAILED;
  }

  return runEvent(cwd, { type: "move", at: now(), id: resolved.task.id, to: status.data });
}

async function doctor(cwd: string, args: Args): Promise<number> {
  const checks = await runDiagnostics(cwd);

  if (flagBool(args, "json")) {
    process.stdout.write(`${JSON.stringify({ cwd, checks }, null, 2)}\n`);
    return EXIT_OK;
  }

  process.stdout.write(`${renderDiagnostics(checks)}\n`);
  return checks.some((c) => c.status === "fail") ? EXIT_FAILED : EXIT_OK;
}

async function enableProject(cwd: string): Promise<number> {
  await setEnabled(cwd, true);

  const existing = await readRuntime(cwd);
  if (existing) {
    process.stdout.write(
      `command-center is enabled for this project.\nBoard: http://127.0.0.1:${existing.port}\n`,
    );
    return EXIT_OK;
  }

  const record = await launchDetachedServer(cwd);
  if (!record) {
    fail(
      "Enabled this project, but the board server did not start.",
      "Run `cmc doctor` to see what went wrong.",
    );
    return EXIT_FAILED;
  }

  process.stdout.write(
    `command-center is enabled for this project.\nBoard: http://127.0.0.1:${record.port}\n`,
  );
  return EXIT_OK;
}

async function skipProject(cwd: string): Promise<number> {
  await setEnabled(cwd, false);
  process.stdout.write(
    "command-center will leave this project alone. Run `cmc enable` if you change your mind.\n",
  );
  return EXIT_OK;
}

/**
 * Starts a server that outlives this command. The record appears only once the
 * server is listening, so waiting for it is the same as waiting for a live port.
 */
async function launchDetachedServer(cwd: string) {
  const child = spawn(process.execPath, ["run", import.meta.path, "server", "--cwd", cwd], {
    cwd,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const record = await readRuntime(cwd);
    if (record) return record;
    await Bun.sleep(60);
  }
  return null;
}

async function serve(cwd: string): Promise<number> {
  const existing = await readRuntime(cwd);
  if (existing) {
    fail(
      `A server is already running for this project on port ${existing.port} (pid ${existing.pid}).`,
      `Open http://127.0.0.1:${existing.port} — or run \`cmc cleanup\` if it is not responding.`,
    );
    return EXIT_FAILED;
  }

  const server = await startServer({ cwd });
  process.stdout.write(`command-center is serving ${cwd} at ${server.url}\n`);

  // startServer installs its own SIGINT/SIGTERM handling; block until then.
  await new Promise<void>(() => {});
  return EXIT_OK;
}

async function cleanup(cwd: string, args: Args): Promise<number> {
  // readRuntime reaps a dead or unreadable record as a side effect of checking it.
  const record = await readRuntime(cwd);
  if (record === null) {
    process.stdout.write("Nothing to clean up.\n");
    return EXIT_OK;
  }

  const force = flagBool(args, "force");
  const holders = record.sessionIds.length;

  // A session killed without SessionEnd leaves its id behind, so a non-empty
  // list is not proof anyone is really watching — hence --force.
  if (holders > 0 && !force) {
    process.stdout.write(
      `The board is still held by ${holders} session(s) on port ${record.port}.\n` +
        `Leaving it running. Use \`cmc cleanup --force\` to stop it anyway.\n`,
    );
    return EXIT_OK;
  }

  try {
    process.kill(record.pid, "SIGTERM");
  } catch {
    await clearRuntime(cwd); // already gone; just tidy the record
    process.stdout.write("Cleared a stale server record.\n");
    return EXIT_OK;
  }

  // The server clears its own record on SIGTERM; wait so the result is truthful.
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && (await readRuntime(cwd)) !== null) {
    await Bun.sleep(50);
  }
  await clearRuntime(cwd);

  process.stdout.write(`Stopped the board server (pid ${record.pid}, port ${record.port}).\n`);
  return EXIT_OK;
}

/** Internal: lets a session register itself against the running server. */
async function attachSessionCmd(cwd: string, args: Args): Promise<number> {
  const sessionId = args.positional[0];
  if (!sessionId) {
    fail("attach-session needs a session id.");
    return EXIT_USAGE;
  }
  await attachSession(cwd, sessionId);
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

async function runEvent(cwd: string, event: Event): Promise<number> {
  const result = await mutate(cwd, event);

  if (!result.ok) {
    fail(result.error.message);
    return EXIT_FAILED;
  }

  for (const effect of result.effects) {
    switch (effect.type) {
      case "task-started":
        process.stdout.write(`${renderTaskForClaude(effect.task)}\n`);
        break;
      case "task-finished":
        process.stdout.write(`"${effect.task.title}" is ready for review.\n`);
        break;
      case "task-approved":
        process.stdout.write(`Approved "${effect.task.title}".\n`);
        break;
      case "task-revised":
        process.stdout.write(`"${effect.task.title}" is back in progress.\n`);
        break;
      case "queue-emptied":
        process.stdout.write("That was the last queued task.\n");
        break;
    }
  }

  if (result.effects.length === 0) process.stdout.write("Done.\n");
  return EXIT_OK;
}

type Resolved = { task: Task } | { error: string; hint?: string };

/** Accepts a full id or any unambiguous prefix — ids are long, humans are not. */
function resolveTask(state: ProjectState, ref: string): Resolved {
  const exact = state.tasks.find((t) => t.id === ref);
  if (exact) return { task: exact };

  const matches = state.tasks.filter((t) => t.id.startsWith(ref));
  if (matches.length === 1) return { task: matches[0]! };

  if (matches.length === 0) {
    return { error: `No task matches "${ref}".`, hint: "Run `cmc list` to see the board." };
  }
  return {
    error: `"${ref}" is ambiguous — it matches ${matches.length} tasks.`,
    hint: `Use more characters: ${matches.map((t) => t.id).join(", ")}`,
  };
}

function fail(message: string, hint?: string): void {
  process.stderr.write(`${message}\n`);
  if (hint) process.stderr.write(`${hint}\n`);
}

function now(): number {
  return Date.now();
}

function newTaskId(): string {
  return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

process.exit(await main(process.argv.slice(2)));
