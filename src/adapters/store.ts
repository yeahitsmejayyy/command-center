import { readFile } from "node:fs/promises";
import { ProjectStateSchema, emptyState, type ProjectState } from "../core/types.ts";
import { atomicWriteFile } from "./atomic.ts";
import { paths } from "./paths.ts";
import { withLock } from "./lock.ts";

/**
 * Persistence for ProjectState.
 *
 * Two independent protections, because they guard different things:
 *   - the lock serialises read-modify-write within and across processes
 *   - the version check catches a caller acting on state it read earlier
 *     (a browser tab that has been open a while, a second terminal)
 */

export class StaleWriteError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
    readonly cwd: string,
  ) {
    super(
      `The board changed while you were working on it (expected version ${expectedVersion}, found ${actualVersion}). ` +
        `Re-read the state and try again.`,
    );
    this.name = "StaleWriteError";
  }
}

export class UnreadableStateError extends Error {
  constructor(
    readonly path: string,
    override readonly cause: unknown,
  ) {
    super(
      `The saved board at ${path} could not be read — it is not valid state. ` +
        `Move it aside to start fresh: mv "${path}" "${path}.broken"`,
    );
    this.name = "UnreadableStateError";
  }
}

export async function readState(cwd: string): Promise<ProjectState> {
  const path = paths.state(cwd);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyState(cwd);
    throw err;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new UnreadableStateError(path, err);
  }

  const parsed = ProjectStateSchema.safeParse(json);
  if (!parsed.success) throw new UnreadableStateError(path, parsed.error);

  return parsed.data;
}

/**
 * Writes state, but only if the file on disk is still at `expectedVersion`.
 * The check and the write happen under the lock, so they cannot interleave.
 */
export async function writeState(
  state: ProjectState,
  expectedVersion: number,
): Promise<void> {
  await withLock(state.cwd, async () => {
    const current = await readState(state.cwd);
    if (current.version !== expectedVersion) {
      throw new StaleWriteError(expectedVersion, current.version, state.cwd);
    }
    await atomicWriteFile(paths.state(state.cwd), `${JSON.stringify(state, null, 2)}\n`);
  });
}
