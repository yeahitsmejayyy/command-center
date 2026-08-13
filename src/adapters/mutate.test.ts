import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutate } from "./mutate.ts";
import { readState } from "./store.ts";

const CWD = "/Users/j/dev/proj";
let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.COMMAND_CENTER_HOME;
  home = mkdtempSync(join(tmpdir(), "cc-mutate-"));
  process.env.COMMAND_CENTER_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.COMMAND_CENTER_HOME;
  else process.env.COMMAND_CENTER_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

describe("mutate", () => {
  test("persists a successful event", async () => {
    const r = await mutate(CWD, { type: "create", at: 1, id: "t1", title: "Ship it", body: "" });

    expect(r.ok).toBe(true);
    expect((await readState(CWD)).tasks).toHaveLength(1);
  });

  test("returns the effects the core emitted", async () => {
    await mutate(CWD, { type: "create", at: 1, id: "t1", title: "Ship it", body: "", status: "queued" });
    const r = await mutate(CWD, { type: "advance", at: 2 });

    if (!r.ok) throw new Error("expected ok");
    expect(r.effects.map((e) => e.type)).toContain("task-started");
  });

  test("does not persist anything when the core rejects", async () => {
    const r = await mutate(CWD, { type: "finish", at: 1 });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected rejection");
    expect(r.error.code).toBe("E_NO_ACTIVE_TASK");
    expect((await readState(CWD)).version).toBe(0);
  });

  test("a rejection leaves earlier state untouched", async () => {
    await mutate(CWD, { type: "create", at: 1, id: "t1", title: "Keep me", body: "" });
    const before = await readState(CWD);

    await mutate(CWD, { type: "move", at: 2, id: "ghost", to: "done" });

    expect(await readState(CWD)).toEqual(before);
  });

  test("sequential mutations each land", async () => {
    await mutate(CWD, { type: "create", at: 1, id: "t1", title: "One", body: "", status: "queued" });
    await mutate(CWD, { type: "create", at: 2, id: "t2", title: "Two", body: "", status: "queued" });
    await mutate(CWD, { type: "advance", at: 3 });
    await mutate(CWD, { type: "finish", at: 4 });
    await mutate(CWD, { type: "approve", at: 5 });

    const state = await readState(CWD);
    expect(state.tasks.find((t) => t.id === "t1")?.status).toBe("done");
    expect(state.version).toBe(5);
  });

  /**
   * Two writers racing on the same board must not lose an update. Each mutation
   * re-reads under the lock, so the second one applies to the first one's
   * result rather than clobbering it.
   */
  test("concurrent mutations both land, without losing either", async () => {
    await Promise.all([
      mutate(CWD, { type: "create", at: 1, id: "a", title: "A", body: "" }),
      mutate(CWD, { type: "create", at: 2, id: "b", title: "B", body: "" }),
    ]);

    const state = await readState(CWD);
    expect(state.tasks.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(state.version).toBe(2);
  });

  test("many concurrent mutations all land", async () => {
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        mutate(CWD, { type: "create", at: i + 1, id: `t${i}`, title: `Task ${i}`, body: "" }),
      ),
    );

    const state = await readState(CWD);
    expect(state.tasks).toHaveLength(15);
    expect(state.version).toBe(15);
  });
});
