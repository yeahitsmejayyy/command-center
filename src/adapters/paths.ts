import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The single owner of on-disk layout. Nothing else builds these strings.
 *
 * State lives under ~/.command-center (override with COMMAND_CENTER_HOME),
 * keyed by the project directory.
 */

export function stateRoot(): string {
  return process.env.COMMAND_CENTER_HOME || join(homedir(), ".command-center");
}

/**
 * Turns a project directory into a filename-safe key.
 *
 * v1 encoded this as `cwd.replace(/\//g, "-")`, which made "/a/b" and "/a-b"
 * both become "a-b" — two unrelated projects silently sharing one state file.
 * The readable slug is kept for humans scanning the directory, but identity
 * comes from a hash of the full path, so distinct projects can never collide.
 */
export function encodeCwd(cwd: string): string {
  const normalized = cwd.replace(/\/+$/, "") || "/";
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 10);
  const slug = normalized
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join("-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);

  return slug ? `${slug}-${digest}` : digest;
}

const dir = {
  state: () => join(stateRoot(), "state"),
  runtime: () => join(stateRoot(), "runtime"),
  locks: () => join(stateRoot(), "locks"),
  logs: () => join(stateRoot(), "logs"),
  prefs: () => join(stateRoot(), "preferences"),
};

export const paths = {
  root: stateRoot,
  dirs: () => Object.values(dir).map((f) => f()),

  state: (cwd: string) => join(dir.state(), `${encodeCwd(cwd)}.json`),
  runtime: (cwd: string) => join(dir.runtime(), `${encodeCwd(cwd)}.json`),
  lock: (cwd: string) => join(dir.locks(), `${encodeCwd(cwd)}.lock`),
  log: (cwd: string) => join(dir.logs(), `${encodeCwd(cwd)}.log`),
  prefs: (cwd: string) => join(dir.prefs(), `${encodeCwd(cwd)}.json`),
};
