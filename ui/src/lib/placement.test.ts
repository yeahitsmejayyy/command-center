import { describe, expect, test } from "bun:test";
import type { Task, TaskStatus } from "../api.ts";
import { columnTasks, planDrop, type Drop } from "./placement.ts";

/**
 * Where a dropped card lands.
 *
 * The feel of dragging has to be judged by eye, but this part is arithmetic and
 * can be wrong in ways that only show up as a card quietly appearing in the
 * wrong place.
 */

const COLUMNS: readonly TaskStatus[] = [
  "backlog",
  "queued",
  "in-progress",
  "awaiting-review",
  "done",
];

/** Applies a plan, so a test can assert on the board the user would see. */
function applied(tasks: Task[], activeId: string, drop: Drop): Task[] {
  return tasks.map((t) =>
    t.id === activeId ? { ...t, status: drop.status, order: drop.order } : t,
  );
}

function task(id: string, status: TaskStatus, order: number): Task {
  return {
    id, title: id, body: "", status, order,
    createdAt: 0, startedAt: null, finishedAt: null,
    attempts: 0, planMode: false, sessionId: null, attachments: [],
  };
}

/** The ids of a column after a plan is applied — what the user actually sees. */
function orderAfter(tasks: Task[], activeId: string, overId: string): string[] {
  const drop = planDrop(tasks, activeId, overId, COLUMNS)!;
  return columnTasks(applied(tasks, activeId, drop), drop.status).map((t) => t.id);
}

const column = () => [
  task("a", "queued", 0),
  task("b", "queued", 1),
  task("c", "queued", 2),
];

describe("reordering within a column", () => {
  /**
   * Sortable semantics: dragging down onto a card lands after it, dragging up
   * lands before it. Anything else disagrees with the preview animation, which
   * is what makes a board feel broken.
   */
  test("dragging the first card down onto the last puts it last", () => {
    expect(orderAfter(column(), "a", "c")).toEqual(["b", "c", "a"]);
  });

  test("dragging the last card up onto the first puts it first", () => {
    expect(orderAfter(column(), "c", "a")).toEqual(["c", "a", "b"]);
  });

  test("dragging down by one swaps with the next card", () => {
    expect(orderAfter(column(), "a", "b")).toEqual(["b", "a", "c"]);
  });

  test("dragging up by one swaps with the previous card", () => {
    expect(orderAfter(column(), "c", "b")).toEqual(["a", "c", "b"]);
  });

  test("dropping a card on itself changes nothing", () => {
    expect(orderAfter(column(), "b", "b")).toEqual(["a", "b", "c"]);
  });

  test("the middle card can reach both ends", () => {
    expect(orderAfter(column(), "b", "a")).toEqual(["b", "a", "c"]);
    expect(orderAfter(column(), "b", "c")).toEqual(["a", "c", "b"]);
  });

  test("repeated reordering stays stable rather than drifting", () => {
    let tasks = column();
    for (let i = 0; i < 10; i++) {
      const drop = planDrop(tasks, "a", "c", COLUMNS)!;
      tasks = applied(tasks, "a", drop);
      const drop2 = planDrop(tasks, "a", "b", COLUMNS)!;
      tasks = applied(tasks, "a", drop2);
    }
    expect(columnTasks(tasks, "queued")).toHaveLength(3);
    expect(new Set(columnTasks(tasks, "queued").map((t) => t.order)).size).toBe(3);
  });
});

describe("moving between columns", () => {
  const board = () => [
    task("a", "backlog", 0),
    task("b", "backlog", 1),
    task("x", "queued", 0),
    task("y", "queued", 1),
  ];

  test("dropping on a column appends to it", () => {
    expect(orderAfter(board(), "a", "queued")).toEqual(["x", "y", "a"]);
  });

  test("dropping on the first card of another column lands above it", () => {
    expect(orderAfter(board(), "a", "x")).toEqual(["a", "x", "y"]);
  });

  test("dropping on the second card lands between the two", () => {
    expect(orderAfter(board(), "a", "y")).toEqual(["x", "a", "y"]);
  });

  test("an empty column accepts the card", () => {
    // Queue is empty here; done is deliberately not droppable, so it cannot
    // stand in for "an empty column" any more.
    const onlyBacklog = [task("a", "backlog", 0), task("b", "backlog", 1)];
    expect(orderAfter(onlyBacklog, "a", "queued")).toEqual(["a"]);
  });

  test("the card leaves the column it came from", () => {
    const drop = planDrop(board(), "a", "queued", COLUMNS)!;
    const after = applied(board(), "a", drop);

    expect(columnTasks(after, "backlog").map((t) => t.id)).toEqual(["b"]);
  });

  test("the status comes from the column, not the card's old one", () => {
    expect(planDrop(board(), "a", "y", COLUMNS)?.status).toBe("queued");
  });
});

describe("only the waiting columns accept a dragged card", () => {
  /**
   * Backlog and queue hold work that has not happened yet, so a person may put
   * anything there. The columns to their right are records of what the workflow
   * did — advanced, finished, approved — and a card dragged into one would
   * assert something that never took place.
   */
  const board = () => [
    task("shelved", "backlog", 0),
    task("queued-one", "queued", 0),
    task("running", "in-progress", 0),
    task("reviewing", "awaiting-review", 0),
    task("finished", "done", 0),
  ];

  for (const closed of ["in-progress", "awaiting-review", "done"] as const) {
    test(`a queued card cannot be dropped into ${closed}`, () => {
      expect(planDrop(board(), "queued-one", closed, COLUMNS)).toBeNull();
    });
  }

  test("nor onto a card sitting in one of those columns", () => {
    expect(planDrop(board(), "queued-one", "running", COLUMNS)).toBeNull();
    expect(planDrop(board(), "queued-one", "reviewing", COLUMNS)).toBeNull();
    expect(planDrop(board(), "queued-one", "finished", COLUMNS)).toBeNull();
  });

  test("even when the column is empty", () => {
    const idle = [task("queued-one", "queued", 0)];
    expect(planDrop(idle, "queued-one", "in-progress", COLUMNS)).toBeNull();
    expect(planDrop(idle, "queued-one", "done", COLUMNS)).toBeNull();
  });

  test("backlog and queue still accept anything", () => {
    expect(planDrop(board(), "finished", "backlog", COLUMNS)?.status).toBe("backlog");
    expect(planDrop(board(), "reviewing", "queued", COLUMNS)?.status).toBe("queued");
    expect(planDrop(board(), "running", "queued", COLUMNS)?.status).toBe("queued");
  });

  test("a card can always be dragged out — that is how work is stopped or undone", () => {
    expect(planDrop(board(), "running", "backlog", COLUMNS)?.status).toBe("backlog");
    expect(planDrop(board(), "finished", "queued", COLUMNS)?.status).toBe("queued");
  });

  test("reordering inside a closed column is still allowed", () => {
    const two = [task("a", "done", 0), task("b", "done", 1)];
    expect(planDrop(two, "b", "a", COLUMNS)?.status).toBe("done");
  });
});

describe("a plan is self-consistent", () => {
  /**
   * The animation shown while dragging and the state committed on release come
   * from the same plan, so they cannot disagree.
   */
  test("planning the same hover twice produces the same board", () => {
    const tasks = column();
    const drop = planDrop(tasks, "a", "c", COLUMNS)!;

    const first = columnTasks(applied(tasks, "a", drop), "queued").map((t) => t.id);
    const second = columnTasks(
      applied(tasks, "a", planDrop(tasks, "a", "c", COLUMNS)!),
      "queued",
    ).map((t) => t.id);

    expect(first).toEqual(second);
  });
});

describe("bad input", () => {
  test("an unknown card plans nothing", () => {
    expect(planDrop(column(), "ghost", "a", COLUMNS)).toBeNull();
    expect(planDrop(column(), "a", "ghost", COLUMNS)).toBeNull();
  });
});
