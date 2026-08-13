import { readFile, unlink } from "node:fs/promises";
import { z } from "zod";
import { atomicWriteFile } from "./atomic.ts";
import { paths } from "./paths.ts";

/**
 * Per-project runtime records: which process is serving this project, on which
 * port, for which sessions.
 *
 * The port here always comes from an already-listening socket (Bun.serve with
 * port 0 reports the port it actually bound), so a record never names a port
 * that nobody holds — v1's race came from allocating a port, closing it, and
 * handing the bare number to a process that had to bind it again.
 *
 * Records are treated as claims, not facts. A process can die without cleaning
 * up, so every read verifies the pid is alive and deletes the record if not —
 * a stale record can never mislead a caller into connecting to a dead port.
 */

export const RuntimeRecordSchema = z.object({
  cwd: z.string().min(1),
  pid: z.number().int().positive(),
  port: z.number().int().positive().max(65_535),
  startedAt: z.number().int().nonnegative(),
  sessionIds: z.array(z.string()),
});
export type RuntimeRecord = z.infer<typeof RuntimeRecordSchema>;

export async function publishRuntime(record: RuntimeRecord): Promise<void> {
  const parsed = RuntimeRecordSchema.parse(record);
  await atomicWriteFile(paths.runtime(parsed.cwd), `${JSON.stringify(parsed, null, 2)}\n`);
}

/** Returns the record only if its process is still alive; reaps it otherwise. */
export async function readRuntime(cwd: string): Promise<RuntimeRecord | null> {
  const path = paths.runtime(cwd);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let record: RuntimeRecord;
  try {
    record = RuntimeRecordSchema.parse(JSON.parse(raw));
  } catch {
    await reap(path); // unreadable is as useless as dead
    return null;
  }

  if (!processAlive(record.pid)) {
    await reap(path);
    return null;
  }

  return record;
}

export async function clearRuntime(cwd: string): Promise<void> {
  await reap(paths.runtime(cwd));
}

async function reap(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
