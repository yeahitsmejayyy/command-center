import { describe, expect, test } from "bun:test";
import { apply } from "./apply.ts";
import { emptyState, type ProjectState, type Task, type TaskStatus } from "./types.ts";

const AT = 1_700_000_000_000;

function stateWith(tasks: Array<Partial<Task> & { id: string }>): ProjectState {
  return {
    ...emptyState("/tmp/proj"),
    version: 1,
    tasks: tasks.map((t, i) => ({
      title: `task ${t.id}`,
      body: "",
      status: "backlog" as TaskStatus,
      order: i,
      createdAt: AT,
      startedAt: null,
      finishedAt: null,
      attempts: 0,
      planMode: false,
      sessionId: null,
      ...t,
    })),
  };
}

function expectOk(result: ReturnType<typeof apply>) {
  if (!result.ok) throw new Error(`expected ok, got rejection ${result.error.code}`);
  return result;
}

function expectErr(result: ReturnType<typeof apply>) {
  if (result.ok) throw new Error("expected rejection, got ok");
  return result;
}

describe("create", () => {
  test("adds a task to backlog by default", () => {
    const r = expectOk(apply(emptyState("/tmp/proj"), { type: "create", at: AT, id: "t1", title: "Write docs", body: "" }));

    expect(r.state.tasks).toHaveLength(1);
    expect(r.state.tasks[0]!.status).toBe("backlog");
    expect(r.state.tasks[0]!.title).toBe("Write docs");
  });

  test("rejects a duplicate id without touching state", () => {
    const before = stateWith([{ id: "t1" }]);
    const r = expectErr(apply(before, { type: "create", at: AT, id: "t1", title: "Dupe", body: "" }));

    expect(r.error.code).toBe("E_DUPLICATE_ID");
  });

  test("rejects an empty title", () => {
    const r = expectErr(apply(emptyState("/tmp/proj"), { type: "create", at: AT, id: "t1", title: "   ", body: "" }));
    expect(r.error.code).toBe("E_INVALID_INPUT");
  });
});

describe("version", () => {
  test("increments by exactly one on success", () => {
    const before = stateWith([{ id: "t1" }]);
    const r = expectOk(apply(before, { type: "move", at: AT, id: "t1", to: "queued" }));

    expect(r.state.version).toBe(before.version + 1);
  });

  test("does not change on rejection", () => {
    const before = stateWith([{ id: "t1" }]);
    const r = expectErr(apply(before, { type: "move", at: AT, id: "nope", to: "queued" }));

    expect(r.error.code).toBe("E_TASK_NOT_FOUND");
  });

  test("does not change on a no-op move to the same status", () => {
    const before = stateWith([{ id: "t1", status: "queued" }]);
    const r = expectOk(apply(before, { type: "move", at: AT, id: "t1", to: "queued" }));

    expect(r.state.version).toBe(before.version);
  });
});

describe("purity", () => {
  test("never mutates the state it was given", () => {
    const before = stateWith([{ id: "t1", status: "queued" }]);
    const snapshot = structuredClone(before);

    apply(before, { type: "move", at: AT, id: "t1", to: "in-progress" });

    expect(before).toEqual(snapshot);
  });
});
