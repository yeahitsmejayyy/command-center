import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "./paths.ts";

/**
 * Per-project structured logging: one JSON object per line.
 *
 * A long-running server that only writes to stdout is a server whose failures
 * are invisible — nobody is watching the terminal it was spawned from. Lines
 * are JSON so they can be grepped and parsed; `path` is exposed so every error
 * message can tell the user where to look.
 */

export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  readonly path: string;
  info(msg: string, fields?: Record<string, unknown>): Promise<void>;
  warn(msg: string, fields?: Record<string, unknown>): Promise<void>;
  error(msg: string, fields?: Record<string, unknown>): Promise<void>;
}

export function logFor(cwd: string): Logger {
  const path = paths.log(cwd);

  const write = async (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    const entry = { ts: Date.now(), level, msg, ...(fields ?? {}) };
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await appendFile(path, `${serialise(entry)}\n`, { mode: 0o600 });
    } catch {
      // Logging must never take the process down with it.
    }
  };

  return {
    path,
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}

/** A cyclic or otherwise unserialisable field must not lose the whole entry. */
function serialise(entry: Record<string, unknown>): string {
  try {
    return JSON.stringify(entry);
  } catch {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      try {
        JSON.stringify(value);
        safe[key] = value;
      } catch {
        safe[key] = "[unserialisable]";
      }
    }
    return JSON.stringify(safe);
  }
}
