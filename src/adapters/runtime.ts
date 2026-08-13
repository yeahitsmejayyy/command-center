import { readFile, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { z } from "zod";
import { atomicWriteFile } from "./atomic.ts";
import { paths } from "./paths.ts";

/**
 * Per-project runtime records: which process is serving this project, on which
 * port, for which sessions.
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

export interface Listener {
  readonly host: "127.0.0.1";
  readonly port: number;
  /** The live socket, handed over so a server can adopt it without rebinding. */
  readonly server: Server;
  close(): Promise<void>;
}

/**
 * Binds an OS-assigned port on loopback and returns the *listening* socket.
 *
 * The socket is deliberately never closed here. v1 bound :0, read the port,
 * closed the socket, and passed the bare number to a child process that had to
 * bind it again — leaving a window where anything else on the machine could
 * claim it first. That race isn't retried away here; it doesn't exist, because
 * the port is still held by the listener that reports it.
 */
export function bindLoopback(): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);

    // Loopback only. Never 0.0.0.0 — this must not be reachable from the network.
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        server.close();
        reject(new Error("The OS did not report a bound port."));
        return;
      }

      server.removeListener("error", reject);
      resolve({
        host: "127.0.0.1",
        port: address.port,
        server,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

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
