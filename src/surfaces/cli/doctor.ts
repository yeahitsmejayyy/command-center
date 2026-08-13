import { access, constants, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";
import { paths } from "../../adapters/paths.ts";
import { readRuntime } from "../../adapters/runtime.ts";
import { readState } from "../../adapters/store.ts";

/**
 * doctor is a product surface, not a debug dump.
 *
 * Every known failure mode gets a name, a plain-language diagnosis, and a
 * command you can actually run. If a check can fail, it explains the fix — a
 * diagnosis without a remedy just relocates the confusion.
 */

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  /** A command the user can run. Present whenever status is not "ok". */
  fix?: string;
  path?: string;
}

const MIN_BUN = [1, 3, 0] as const;

export async function runDiagnostics(cwd: string): Promise<Check[]> {
  return [
    checkBun(),
    await checkDependencies(),
    await checkStateRoot(),
    await checkStateFile(cwd),
    await checkLock(cwd),
    await checkServer(cwd),
  ];
}

/**
 * The plugin ships source, so its runtime dependency must genuinely be present.
 *
 * Claude Code installs plugin dependencies when it caches the plugin, but the
 * docs are explicit that a failed install never blocks the plugin and is only
 * recorded in debug output. When that happens Bun quietly auto-installs
 * whatever version it can reach instead — observed resolving zod 4.x against a
 * `^3` pin — so "it ran" is not proof the right code loaded. This checks both
 * that the dependency resolves and that its major version is the expected one.
 */
async function checkDependencies(): Promise<Check> {
  const EXPECTED_MAJOR = 3;

  try {
    const { z } = await import("zod");
    // Round-trip a schema: proves the library is loaded and behaving.
    const probe = z.object({ ok: z.boolean() }).safeParse({ ok: true });
    if (!probe.success) {
      return {
        name: "dependencies",
        status: "fail",
        detail: "zod is installed but did not validate a trivial schema.",
        fix: `bun install --cwd "${pluginRoot()}"`,
      };
    }

    // Where it resolved from is the real signal. If zod did not come from the
    // plugin's own node_modules, the pinned install never happened and Bun
    // auto-installed whatever it could reach — which is how a `^3` pin ends up
    // running 4.x. "It loaded" is not the same as "the right one loaded".
    const from = resolvedFrom();
    const expectedPrefix = join(pluginRoot(), "node_modules");

    if (from && !from.startsWith(expectedPrefix)) {
      return {
        name: "dependencies",
        status: "warn",
        detail:
          `zod is being auto-resolved from ${from} rather than the plugin's own node_modules, ` +
          `so its version is whatever Bun had to hand — not the pinned ${EXPECTED_MAJOR}.x. ` +
          `The plugin's dependency install did not complete.`,
        fix: `bun install --cwd "${pluginRoot()}"`,
      };
    }

    const version = await installedZodVersion();
    const major = version ? Number.parseInt(version.split(".")[0] ?? "", 10) : null;

    if (major !== null && major !== EXPECTED_MAJOR) {
      return {
        name: "dependencies",
        status: "warn",
        detail: `zod ${version} is installed, but this build expects ${EXPECTED_MAJOR}.x.`,
        fix: `bun install --cwd "${pluginRoot()}"`,
      };
    }

    return {
      name: "dependencies",
      status: "ok",
      detail: version ? `zod ${version}` : "zod is installed",
    };
  } catch {
    return {
      name: "dependencies",
      status: "fail",
      detail:
        "The runtime dependency (zod) is not installed, so command-center cannot run. " +
        "This usually means the plugin's dependency install did not complete.",
      fix: `bun install --cwd "${pluginRoot()}"`,
    };
  }
}

/** Absolute path zod actually resolved to, or null if that cannot be determined. */
function resolvedFrom(): string | null {
  try {
    const url = import.meta.resolve("zod");
    return url.startsWith("file://") ? fileURLToPath(url) : null;
  } catch {
    return null;
  }
}

async function installedZodVersion(): Promise<string | null> {
  try {
    const pkg = await readFile(join(pluginRoot(), "node_modules", "zod", "package.json"), "utf8");
    return (JSON.parse(pkg) as { version?: string }).version ?? null;
  } catch {
    return null; // auto-installed from Bun's global cache: no local copy to read
  }
}

/** The plugin's own directory, whether installed or run from a checkout. */
function pluginRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT ?? join(import.meta.dir, "..", "..", "..");
}

function checkBun(): Check {
  const version = typeof Bun !== "undefined" ? Bun.version : null;
  if (!version) {
    return {
      name: "bun",
      status: "fail",
      detail: "command-center runs on Bun, and Bun was not found.",
      fix: "curl -fsSL https://bun.sh/install | bash",
    };
  }

  const parts = version.split(".").map((n) => Number.parseInt(n, 10));
  if (compareVersion(parts, [...MIN_BUN]) < 0) {
    return {
      name: "bun",
      status: "fail",
      detail: `Bun ${version} is older than the required ${MIN_BUN.join(".")}.`,
      fix: "bun upgrade",
    };
  }

  return { name: "bun", status: "ok", detail: `Bun ${version}` };
}

function compareVersion(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function checkStateRoot(): Promise<Check> {
  const root = paths.root();
  try {
    await access(root, constants.W_OK);
    return { name: "state directory", status: "ok", detail: root, path: root };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Created on first write; nothing wrong with it not existing yet.
      return { name: "state directory", status: "ok", detail: `${root} (not created yet)`, path: root };
    }
    return {
      name: "state directory",
      status: "fail",
      detail: `${root} is not writable.`,
      fix: `chmod u+rwx "${root}"`,
      path: root,
    };
  }
}

async function checkStateFile(cwd: string): Promise<Check> {
  const path = paths.state(cwd);
  try {
    await stat(path);
  } catch {
    return { name: "state file", status: "ok", detail: "No board saved yet for this project.", path };
  }

  try {
    const state = await readState(cwd);
    return {
      name: "state file",
      status: "ok",
      detail: `${state.tasks.length} task(s), version ${state.version}`,
      path,
    };
  } catch {
    return {
      name: "state file",
      status: "fail",
      detail: `The board at ${path} is not readable — it is corrupt or was written by something else.`,
      fix: `mv "${path}" "${path}.broken"`,
      path,
    };
  }
}

async function checkLock(cwd: string): Promise<Check> {
  const path = paths.lock(cwd);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { name: "lock", status: "ok", detail: "No lock held.", path };
  }

  let pid: number | null = null;
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown };
    if (typeof parsed.pid === "number") pid = parsed.pid;
  } catch {
    /* unreadable lock — treated the same as a dead one */
  }

  if (pid !== null && alive(pid)) {
    return { name: "lock", status: "ok", detail: `Held by pid ${pid}, which is running.`, path };
  }

  return {
    name: "lock",
    status: "warn",
    detail:
      pid === null
        ? `A lock file at ${path} is unreadable. It is reclaimed automatically, but you can remove it.`
        : `A lock file at ${path} is held by pid ${pid}, which is gone. It is reclaimed automatically.`,
    fix: `rm "${path}"`,
    path,
  };
}

async function checkServer(cwd: string): Promise<Check> {
  const path = paths.runtime(cwd);
  const record = await readRuntime(cwd);

  if (!record) {
    return { name: "server", status: "ok", detail: "Not running for this project.", path };
  }

  const reachable = await canConnect(record.port);
  if (!reachable) {
    return {
      name: "server",
      status: "warn",
      detail: `A server is recorded on port ${record.port} (pid ${record.pid}) but is not answering.`,
      fix: "cmc cleanup",
      path,
    };
  }

  return {
    name: "server",
    status: "ok",
    detail: `Running on http://127.0.0.1:${record.port} (pid ${record.pid})`,
    path,
  };
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.setTimeout(300);
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function renderDiagnostics(checks: Check[]): string {
  const icon: Record<CheckStatus, string> = { ok: "✔", warn: "!", fail: "✘" };
  const lines: string[] = [];

  for (const check of checks) {
    lines.push(`${icon[check.status]} ${check.name}: ${check.detail}`);
    if (check.fix) lines.push(`    fix: ${check.fix}`);
  }

  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  lines.push("");
  lines.push(
    failed > 0
      ? `${failed} problem(s) need attention.`
      : warned > 0
        ? `Everything works; ${warned} thing(s) worth tidying.`
        : "Everything checks out.",
  );

  return lines.join("\n");
}
