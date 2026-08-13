import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState } from "../core/types.ts";
import { paths } from "./paths.ts";
import { readState, writeState, StaleWriteError } from "./store.ts";

const CWD = "/Users/j/dev/proj";
let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.COMMAND_CENTER_HOME;
  home = mkdtempSync(join(tmpdir(), "cc-store-"));
  process.env.COMMAND_CENTER_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.COMMAND_CENTER_HOME;
  else process.env.COMMAND_CENTER_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

describe("readState", () => {
  test("returns empty state for a project that has never been used", async () => {
    const state = await readState(CWD);

    expect(state.tasks).toEqual([]);
    expect(state.version).toBe(0);
    expect(state.cwd).toBe(CWD);
  });

  test("round-trips what was written", async () => {
    const state = { ...emptyState(CWD), version: 3, updatedAt: 111, tasks: [] };
    await writeState(state, 0);

    expect(await readState(CWD)).toEqual(state);
  });

  test("rejects a corrupt state file rather than returning junk", async () => {
    await writeState(emptyState(CWD), 0);
    writeFileSync(paths.state(CWD), "{ not json");

    await expect(readState(CWD)).rejects.toThrow(/could not be read|invalid/i);
  });

  test("rejects a file whose shape does not match the schema", async () => {
    await writeState(emptyState(CWD), 0);
    writeFileSync(paths.state(CWD), JSON.stringify({ version: "one", tasks: "nope" }));

    await expect(readState(CWD)).rejects.toThrow();
  });
});

describe("writeState — atomicity", () => {
  test("leaves no temp files behind on success", async () => {
    await writeState({ ...emptyState(CWD), version: 1 }, 0);

    const stateDir = join(home, "state");
    expect(readdirSync(stateDir).filter((f) => f.includes("tmp"))).toEqual([]);
  });

  test("an interrupted write never leaves a partial state file", async () => {
    // Establish a good file, then simulate a crash mid-write by leaving a
    // half-written temp file next to it. The real file must be untouched.
    const good = { ...emptyState(CWD), version: 1 };
    await writeState(good, 0);

    const stateDir = join(home, "state");
    writeFileSync(join(stateDir, "half-written.json.tmp-123"), '{"version": 9, "tas');

    expect(await readState(CWD)).toEqual(good);
  });

  test("writes are readable as valid JSON at every observable moment", async () => {
    // Hammer the same file; every read must parse. Because the write is
    // tmp+rename, a reader sees either the old file or the new one, never a mix.
    let state = emptyState(CWD);
    await writeState(state, 0);

    for (let i = 1; i <= 25; i++) {
      const next = { ...state, version: i, updatedAt: i };
      const write = writeState(next, i - 1);
      const raw = readFileSync(paths.state(CWD), "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
      await write;
      state = next;
    }
  });
});

describe("writeState — optimistic concurrency", () => {
  test("accepts a write based on the current version", async () => {
    await writeState({ ...emptyState(CWD), version: 1 }, 0);
    await writeState({ ...emptyState(CWD), version: 2 }, 1);

    expect((await readState(CWD)).version).toBe(2);
  });

  test("rejects a write whose expected version is stale", async () => {
    await writeState({ ...emptyState(CWD), version: 1 }, 0);
    await writeState({ ...emptyState(CWD), version: 2 }, 1);

    // A writer that still believes the file is at version 1.
    await expect(writeState({ ...emptyState(CWD), version: 2 }, 1)).rejects.toBeInstanceOf(StaleWriteError);
  });

  test("a stale write leaves the winner's data intact", async () => {
    await writeState({ ...emptyState(CWD), version: 1, updatedAt: 100 }, 0);
    await writeState({ ...emptyState(CWD), version: 2, updatedAt: 200 }, 1);

    await writeState({ ...emptyState(CWD), version: 2, updatedAt: 999 }, 1).catch(() => {});

    expect((await readState(CWD)).updatedAt).toBe(200);
  });

  test("the stale error reports both versions so a caller can retry", async () => {
    await writeState({ ...emptyState(CWD), version: 5 }, 0);

    try {
      await writeState({ ...emptyState(CWD), version: 3 }, 2);
      throw new Error("expected a StaleWriteError");
    } catch (err) {
      expect(err).toBeInstanceOf(StaleWriteError);
      expect((err as StaleWriteError).actualVersion).toBe(5);
      expect((err as StaleWriteError).expectedVersion).toBe(2);
    }
  });

  test("two concurrent writers from the same version: one wins, one is rejected cleanly", async () => {
    await writeState({ ...emptyState(CWD), version: 1, updatedAt: 1 }, 0);

    const results = await Promise.allSettled([
      writeState({ ...emptyState(CWD), version: 2, updatedAt: 10 }, 1),
      writeState({ ...emptyState(CWD), version: 2, updatedAt: 20 }, 1),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    // The survivor is intact and parseable — not a blend of both writes.
    const after = await readState(CWD);
    expect(after.version).toBe(2);
    expect([10, 20]).toContain(after.updatedAt);
  });
});
