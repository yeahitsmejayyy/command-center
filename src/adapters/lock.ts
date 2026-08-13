import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "./paths.ts";

/**
 * Advisory per-project lock.
 *
 * Acquisition is O_EXCL file creation, which is atomic across processes. The
 * lock records the pid that holds it, so a lock left behind by a crash can be
 * reclaimed by checking whether that process still exists — v1 keyed staleness
 * off the file's mtime, which meant a dead holder still blocked everyone for
 * the full timeout, and a hand-deleted lock file was the documented fix.
 *
 * In-process contention is handled separately: file creation can't serialise
 * two async callers inside one process, so same-process waiters queue on a
 * promise chain.
 */

const DEFAULT_TIMEOUT_MS = 5_000;
const RETRY_MS = 20;

export class LockTimeoutError extends Error {
  constructor(
    readonly lockPath: string,
    readonly holderPid: number | null,
  ) {
    super(
      holderPid === null
        ? `Timed out waiting for the lock at ${lockPath}. If nothing else is running, delete it: rm "${lockPath}"`
        : `Timed out waiting for the lock at ${lockPath}, held by pid ${holderPid}. ` +
          `If that process is gone, delete the lock: rm "${lockPath}"`,
    );
    this.name = "LockTimeoutError";
  }
}

type LockFileContents = { pid: number; at: number };

/** Same-process serialisation, keyed by lock path. */
const queues = new Map<string, Promise<unknown>>();

export function withLock<T>(
  cwd: string,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const path = paths.lock(cwd);
  const previous = queues.get(path) ?? Promise.resolve();

  const run = previous
    .catch(() => {}) // a previous holder failing must not poison the queue
    .then(() => exclusive(path, fn, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS));

  queues.set(path, run);
  void run.catch(() => {}).finally(() => {
    if (queues.get(path) === run) queues.delete(path);
  });

  return run;
}

async function exclusive<T>(path: string, fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  await acquire(path, timeoutMs);
  try {
    return await fn();
  } finally {
    await unlink(path).catch(() => {});
  }
}

async function acquire(path: string, timeoutMs: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        const body: LockFileContents = { pid: process.pid, at: Date.now() };
        await handle.writeFile(JSON.stringify(body));
      } finally {
        await handle.close();
      }
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      // Someone holds it. If they're gone, take it; liveness, not age.
      const holder = await readHolder(path);
      if (holder === null || !processAlive(holder.pid)) {
        await unlink(path).catch(() => {});
        continue;
      }

      if (Date.now() >= deadline) throw new LockTimeoutError(path, holder.pid);
      await Bun.sleep(RETRY_MS);
    }
  }
}

/** null means "no readable holder" — a truncated, empty, or garbage lock file. */
async function readHolder(path: string): Promise<LockFileContents | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as LockFileContents).pid === "number"
    ) {
      return parsed as LockFileContents;
    }
    return null;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to another user — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
