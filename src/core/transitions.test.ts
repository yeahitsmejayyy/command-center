import { describe, expect, test } from "bun:test";
import { apply } from "./apply.ts";
import {
  TERMINAL_STATUSES,
  TaskStatusSchema,
  activeTask,
  emptyState,
  type ProjectState,
  type Task,
  type TaskStatus,
} from "./types.ts";

/**
 * Exhaustive coverage of the transition table in docs/architecture.md:
 * every (status × event) pair, including the ones that must be rejected.
 */

const AT = 1_700_000_000_000;
const LATER = AT + 60_000;
const ALL: TaskStatus[] = TaskStatusSchema.options;

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `task ${id}`,
    body: "body",
    status: "backlog",
    order: 0,
    createdAt: AT,
    startedAt: null,
    finishedAt: null,
    attempts: 0,
    planMode: false,
    sessionId: null,
    attachments: [],
    ...over,
  };
}

/** A task parked in `status`, with the fields that status implies. */
function taskIn(id: string, status: TaskStatus, over: Partial<Task> = {}): Task {
  return task(id, {
    status,
    startedAt: status === "in-progress" ? AT : null,
    finishedAt: TERMINAL_STATUSES.includes(status) ? AT : null,
    attempts: status === "in-progress" ? 1 : 0,
    ...over,
  });
}

function stateOf(tasks: Task[]): ProjectState {
  return { ...emptyState("/tmp/proj"), version: 1, tasks };
}

function ok(r: ReturnType<typeof apply>) {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r;
}
function err(r: ReturnType<typeof apply>) {
  if (r.ok) throw new Error("expected a rejection, got ok");
  return r.error;
}
function find(s: ProjectState, id: string): Task {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`task ${id} vanished`);
  return t;
}

// ---------------------------------------------------------------------------
// move: the full 6 × 6 matrix
// ---------------------------------------------------------------------------

describe("move — every from/to pair", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      test(`${from} → ${to}`, () => {
        const before = stateOf([taskIn("t1", from)]);
        const r = ok(apply(before, { type: "move", at: LATER, id: "t1", to }));

        expect(find(r.state, "t1").status).toBe(to);

        if (from === to) {
          // A no-op still succeeds, but must not bump version.
          expect(r.state.version).toBe(before.version);
        } else {
          expect(r.state.version).toBe(before.version + 1);
        }
      });
    }
  }
});

describe("move — field effects", () => {
  test("entering in-progress stamps startedAt, clears finishedAt, increments attempts", () => {
    const before = stateOf([taskIn("t1", "awaiting-review", { attempts: 2 })]);
    const t = find(ok(apply(before, { type: "move", at: LATER, id: "t1", to: "in-progress" })).state, "t1");

    expect(t.startedAt).toBe(LATER);
    expect(t.finishedAt).toBeNull();
    expect(t.attempts).toBe(3);
  });

  test("returning to backlog or queued clears both timestamps", () => {
    for (const to of ["backlog", "queued"] as const) {
      const before = stateOf([taskIn("t1", "in-progress")]);
      const t = find(ok(apply(before, { type: "move", at: LATER, id: "t1", to })).state, "t1");

      expect(t.startedAt).toBeNull();
      expect(t.finishedAt).toBeNull();
    }
  });

  test("entering awaiting-review always restamps finishedAt", () => {
    const before = stateOf([taskIn("t1", "done", { finishedAt: AT })]);
    const t = find(ok(apply(before, { type: "move", at: LATER, id: "t1", to: "awaiting-review" })).state, "t1");

    expect(t.finishedAt).toBe(LATER);
  });

  test("done and skipped preserve an existing finishedAt", () => {
    for (const to of ["done", "skipped"] as const) {
      const before = stateOf([taskIn("t1", "awaiting-review", { finishedAt: AT })]);
      const t = find(ok(apply(before, { type: "move", at: LATER, id: "t1", to })).state, "t1");

      expect(t.finishedAt).toBe(AT);
    }
  });

  test("move never decreases attempts", () => {
    for (const to of ALL) {
      const before = stateOf([taskIn("t1", "queued", { attempts: 5 })]);
      const t = find(ok(apply(before, { type: "move", at: LATER, id: "t1", to })).state, "t1");

      expect(t.attempts).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("move — single-active invariant", () => {
  test("rejects moving a second task into in-progress", () => {
    const before = stateOf([taskIn("a", "in-progress"), taskIn("b", "queued")]);
    const e = err(apply(before, { type: "move", at: LATER, id: "b", to: "in-progress" }));

    expect(e.code).toBe("E_CONFLICT");
    expect(e.taskId).toBe("a"); // names the task that is actually blocking
  });

  test("allows it once the first task has moved out", () => {
    const cleared = ok(
      apply(stateOf([taskIn("a", "in-progress"), taskIn("b", "queued")]), {
        type: "move", at: LATER, id: "a", to: "awaiting-review",
      }),
    ).state;

    const r = ok(apply(cleared, { type: "move", at: LATER, id: "b", to: "in-progress" }));
    expect(activeTask(r.state)?.id).toBe("b");
  });

  test("holds after every single move from a clean board", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const r = apply(stateOf([taskIn("t1", from), taskIn("t2", "queued")]), {
          type: "move", at: LATER, id: "t1", to,
        });
        if (!r.ok) continue;
        expect(r.state.tasks.filter((t) => t.status === "in-progress").length).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// advance / finish / approve / revise
// ---------------------------------------------------------------------------

describe("advance", () => {
  test("starts the lowest-order queued task", () => {
    const before = stateOf([
      taskIn("late", "queued", { order: 9 }),
      taskIn("early", "queued", { order: 1 }),
    ]);
    const r = ok(apply(before, { type: "advance", at: LATER }));

    expect(activeTask(r.state)?.id).toBe("early");
    expect(find(r.state, "early").startedAt).toBe(LATER);
    expect(find(r.state, "early").attempts).toBe(1);
  });

  test("emits task-started carrying the task", () => {
    const r = ok(apply(stateOf([taskIn("t1", "queued")]), { type: "advance", at: LATER }));

    expect(r.effects).toContainEqual({ type: "task-started", task: find(r.state, "t1") });
  });

  test("records the session that started it", () => {
    const r = ok(apply(stateOf([taskIn("t1", "queued")]), { type: "advance", at: LATER, sessionId: "sess-1" }));

    expect(find(r.state, "t1").sessionId).toBe("sess-1");
  });

  test("rejects when a task is already running", () => {
    const before = stateOf([taskIn("a", "in-progress"), taskIn("b", "queued")]);
    expect(err(apply(before, { type: "advance", at: LATER })).code).toBe("E_ALREADY_ACTIVE");
  });

  test("rejects when nothing is queued", () => {
    const before = stateOf([taskIn("t1", "backlog"), taskIn("t2", "done")]);
    expect(err(apply(before, { type: "advance", at: LATER })).code).toBe("E_EMPTY_QUEUE");
  });

  test("emits queue-emptied when it takes the last queued task", () => {
    const r = ok(apply(stateOf([taskIn("t1", "queued")]), { type: "advance", at: LATER }));
    expect(r.effects).toContainEqual({ type: "queue-emptied" });
  });
});

describe("finish", () => {
  test("sends the running task to awaiting-review and stamps finishedAt", () => {
    const r = ok(apply(stateOf([taskIn("t1", "in-progress")]), { type: "finish", at: LATER }));

    expect(find(r.state, "t1").status).toBe("awaiting-review");
    expect(find(r.state, "t1").finishedAt).toBe(LATER);
    expect(r.effects).toContainEqual({ type: "task-finished", task: find(r.state, "t1") });
  });

  test("rejects when nothing is running", () => {
    for (const status of ALL.filter((s) => s !== "in-progress")) {
      expect(err(apply(stateOf([taskIn("t1", status)]), { type: "finish", at: LATER })).code)
        .toBe("E_NO_ACTIVE_TASK");
    }
  });
});

describe("approve", () => {
  test("marks the task under review done", () => {
    const r = ok(apply(stateOf([taskIn("t1", "awaiting-review")]), { type: "approve", at: LATER }));

    expect(find(r.state, "t1").status).toBe("done");
    expect(r.effects).toContainEqual({ type: "task-approved", task: find(r.state, "t1") });
  });

  test("takes the oldest review first", () => {
    const before = stateOf([
      taskIn("newer", "awaiting-review", { finishedAt: AT + 5000 }),
      taskIn("older", "awaiting-review", { finishedAt: AT }),
    ]);
    const r = ok(apply(before, { type: "approve", at: LATER }));

    expect(find(r.state, "older").status).toBe("done");
    expect(find(r.state, "newer").status).toBe("awaiting-review");
  });

  test("rejects when nothing is awaiting review", () => {
    for (const status of ALL.filter((s) => s !== "awaiting-review")) {
      expect(err(apply(stateOf([taskIn("t1", status)]), { type: "approve", at: LATER })).code)
        .toBe("E_NOTHING_TO_REVIEW");
    }
  });
});

describe("revise", () => {
  test("returns the reviewed task to in-progress, clears finishedAt, bumps attempts", () => {
    const before = stateOf([taskIn("t1", "awaiting-review", { attempts: 1 })]);
    const r = ok(apply(before, { type: "revise", at: LATER }));

    expect(find(r.state, "t1").status).toBe("in-progress");
    expect(find(r.state, "t1").finishedAt).toBeNull();
    expect(find(r.state, "t1").attempts).toBe(2);
    expect(r.effects).toContainEqual({ type: "task-revised", task: find(r.state, "t1") });
  });

  test("rejects when nothing is awaiting review", () => {
    expect(err(apply(stateOf([taskIn("t1", "queued")]), { type: "revise", at: LATER })).code)
      .toBe("E_NOTHING_TO_REVIEW");
  });

  test("rejects when another task is already running", () => {
    const before = stateOf([taskIn("a", "in-progress"), taskIn("b", "awaiting-review")]);
    const e = err(apply(before, { type: "revise", at: LATER }));

    expect(e.code).toBe("E_CONFLICT");
    expect(e.taskId).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// update / delete / reorder — legal from every status
// ---------------------------------------------------------------------------

describe("update", () => {
  test("edits content from any status", () => {
    for (const status of ALL) {
      const r = ok(apply(stateOf([taskIn("t1", status)]), {
        type: "update", at: LATER, id: "t1", title: "new title", body: "new body",
      }));

      expect(find(r.state, "t1").title).toBe("new title");
      expect(find(r.state, "t1").status).toBe(status); // never changes status
    }
  });

  test("leaves omitted fields alone", () => {
    const before = stateOf([taskIn("t1", "queued", { title: "keep", body: "keep body" })]);
    const t = find(ok(apply(before, { type: "update", at: LATER, id: "t1", body: "changed" })).state, "t1");

    expect(t.title).toBe("keep");
    expect(t.body).toBe("changed");
  });

  test("does not bump version when nothing actually changed", () => {
    const before = stateOf([taskIn("t1", "queued", { title: "same" })]);
    const r = ok(apply(before, { type: "update", at: LATER, id: "t1", title: "same" }));

    expect(r.state.version).toBe(before.version);
  });

  test("rejects an empty title", () => {
    const before = stateOf([taskIn("t1", "queued")]);
    expect(err(apply(before, { type: "update", at: LATER, id: "t1", title: "  " })).code)
      .toBe("E_INVALID_INPUT");
  });
});

describe("delete", () => {
  test("removes a task from any status", () => {
    for (const status of ALL) {
      const r = ok(apply(stateOf([taskIn("t1", status)]), { type: "delete", at: LATER, id: "t1" }));
      expect(r.state.tasks).toHaveLength(0);
    }
  });

  test("deleting the running task leaves nothing active", () => {
    const r = ok(apply(stateOf([taskIn("t1", "in-progress")]), { type: "delete", at: LATER, id: "t1" }));
    expect(activeTask(r.state)).toBeUndefined();
  });
});

describe("placing a task at a position", () => {
  /**
   * Dropping a card between two others needs a position between their orders.
   * Integers run out immediately — there is nothing between 1 and 2 — so order
   * is a real number and the surface picks the midpoint.
   */
  test("reorder accepts a fractional order", () => {
    const before = stateOf([
      taskIn("a", "queued", { order: 1 }),
      taskIn("b", "queued", { order: 2 }),
      taskIn("c", "backlog", { order: 0 }),
    ]);
    const r = ok(apply(before, { type: "reorder", at: LATER, id: "c", order: 1.5 }));

    expect(find(r.state, "c").order).toBe(1.5);
  });

  test("move can place the task at a position in its new column", () => {
    const before = stateOf([
      taskIn("a", "queued", { order: 0 }),
      taskIn("b", "queued", { order: 1 }),
      taskIn("dropped", "backlog", { order: 7 }),
    ]);
    const r = ok(apply(before, { type: "move", at: LATER, id: "dropped", to: "queued", order: 0.5 }));

    expect(find(r.state, "dropped").status).toBe("queued");
    expect(find(r.state, "dropped").order).toBe(0.5);
  });

  /**
   * Without this, a card dragged into a column keeps whatever order it had
   * there before and lands somewhere the user did not point at.
   */
  test("move without an order leaves the existing order alone", () => {
    const before = stateOf([taskIn("t1", "backlog", { order: 3 })]);
    const r = ok(apply(before, { type: "move", at: LATER, id: "t1", to: "queued" }));

    expect(find(r.state, "t1").order).toBe(3);
  });

  test("a move within the same column still applies the position", () => {
    // Otherwise a same-column drop is silently swallowed by the no-op guard.
    const before = stateOf([taskIn("t1", "queued", { order: 5 })]);
    const r = ok(apply(before, { type: "move", at: LATER, id: "t1", to: "queued", order: 1.5 }));

    expect(find(r.state, "t1").order).toBe(1.5);
    expect(r.state.version).toBe(before.version + 1);
  });

  test("a move to the same column with no position is still a no-op", () => {
    const before = stateOf([taskIn("t1", "queued", { order: 5 })]);
    const r = ok(apply(before, { type: "move", at: LATER, id: "t1", to: "queued" }));

    expect(r.state.version).toBe(before.version);
  });

  test("a placed move still applies the destination's field effects", () => {
    const before = stateOf([taskIn("t1", "queued", { order: 9, attempts: 1 })]);
    const r = ok(apply(before, { type: "move", at: LATER, id: "t1", to: "in-progress", order: 0 }));

    expect(find(r.state, "t1").startedAt).toBe(LATER);
    expect(find(r.state, "t1").attempts).toBe(2);
    expect(find(r.state, "t1").order).toBe(0);
  });
});

describe("reorder", () => {
  test("sets order without touching status", () => {
    const r = ok(apply(stateOf([taskIn("t1", "queued", { order: 0 })]), {
      type: "reorder", at: LATER, id: "t1", order: 7,
    }));

    expect(find(r.state, "t1").order).toBe(7);
    expect(find(r.state, "t1").status).toBe("queued");
  });

  test("does not bump version when the order is unchanged", () => {
    const before = stateOf([taskIn("t1", "queued", { order: 3 })]);
    const r = ok(apply(before, { type: "reorder", at: LATER, id: "t1", order: 3 }));

    expect(r.state.version).toBe(before.version);
  });
});

// ---------------------------------------------------------------------------
// Universal rejections
// ---------------------------------------------------------------------------

describe("universal rejections", () => {
  test("every task-scoped event rejects an unknown id", () => {
    const before = stateOf([taskIn("t1", "queued")]);
    const events = [
      { type: "move", at: LATER, id: "ghost", to: "done" },
      { type: "update", at: LATER, id: "ghost", title: "x" },
      { type: "delete", at: LATER, id: "ghost" },
      { type: "reorder", at: LATER, id: "ghost", order: 1 },
    ] as const;

    for (const event of events) {
      expect(err(apply(before, event)).code).toBe("E_TASK_NOT_FOUND");
    }
  });

  test("an unknown status is rejected as invalid input", () => {
    const before = stateOf([taskIn("t1", "queued")]);
    // Deliberately bypassing the type system the way a bad HTTP payload would.
    expect(err(apply(before, { type: "move", at: LATER, id: "t1", to: "nonsense" } as never)).code)
      .toBe("E_INVALID_INPUT");
  });

  test("a negative timestamp is rejected", () => {
    expect(err(apply(emptyState("/tmp/p"), { type: "create", at: -1, id: "t1", title: "x", body: "" })).code)
      .toBe("E_INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// Invariants — asserted over a realistic run of events
// ---------------------------------------------------------------------------

describe("invariants hold across a full lifecycle", () => {
  test("backlog → queued → in-progress → review → revise → review → done", () => {
    let s = emptyState("/tmp/proj");
    const step = (event: Parameters<typeof apply>[1]) => {
      const r = apply(s, event);
      if (!r.ok) throw new Error(`unexpected rejection ${r.error.code}: ${r.error.message}`);
      // Invariants that must hold after *every* event.
      expect(r.state.tasks.filter((t) => t.status === "in-progress").length).toBeLessThanOrEqual(1);
      expect(new Set(r.state.tasks.map((t) => t.id)).size).toBe(r.state.tasks.length);
      expect(r.state.version).toBeGreaterThanOrEqual(s.version);
      s = r.state;
      return r;
    };

    step({ type: "create", at: AT, id: "t1", title: "Ship it", body: "do the thing" });
    step({ type: "move", at: AT + 1, id: "t1", to: "queued" });
    step({ type: "advance", at: AT + 2 });
    expect(find(s, "t1").attempts).toBe(1);

    step({ type: "finish", at: AT + 3 });
    expect(find(s, "t1").status).toBe("awaiting-review");

    step({ type: "revise", at: AT + 4 });
    expect(find(s, "t1").attempts).toBe(2);
    expect(find(s, "t1").finishedAt).toBeNull();

    step({ type: "finish", at: AT + 5 });
    step({ type: "approve", at: AT + 6 });

    expect(find(s, "t1").status).toBe("done");
    expect(find(s, "t1").finishedAt).toBe(AT + 5);
    // create, move, advance, finish, revise, finish, approve — 7 successful applies from 0
    expect(s.version).toBe(7);
  });

  test("finishedAt is set exactly for terminal statuses", () => {
    for (const status of ALL) {
      const r = ok(apply(stateOf([taskIn("t1", "queued")]), { type: "move", at: LATER, id: "t1", to: status }));
      const t = find(r.state, "t1");

      if (TERMINAL_STATUSES.includes(status)) {
        expect(t.finishedAt).not.toBeNull();
      } else {
        expect(t.finishedAt).toBeNull();
      }
    }
  });
});
