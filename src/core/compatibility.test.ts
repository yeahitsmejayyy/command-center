import { describe, expect, test } from "bun:test";
import { ProjectStateSchema, TaskSchema } from "./types.ts";

/**
 * Boards outlive the release that wrote them.
 *
 * Updates are pull-based: a user upgrades whenever they run `/plugin update`,
 * and the board on their disk was written by whatever version they were on
 * before. If a release adds a required field, every existing board stops
 * parsing and the user is told their saved board is unreadable — which reads
 * as "the update ate my work".
 *
 * These fixtures are frozen snapshots of what earlier releases actually wrote.
 * They are never edited to match a new schema; that would defeat the point.
 * A new field must be optional or defaulted, and this fails the moment one is
 * not.
 */

/** A task exactly as 2.0.0 wrote it — before attachments existed. */
const TASK_2_0_0 = {
  id: "t_abc123",
  title: "Written by an earlier release",
  body: "with instructions",
  status: "queued",
  order: 0,
  createdAt: 1_700_000_000_000,
  startedAt: null,
  finishedAt: null,
  attempts: 0,
  planMode: false,
  sessionId: null,
};

const BOARD_2_0_0 = {
  version: 7,
  cwd: "/Users/someone/project",
  updatedAt: 1_700_000_000_000,
  tasks: [TASK_2_0_0],
};

describe("a board from an earlier release still opens", () => {
  test("the 2.0.0 task shape parses", () => {
    const parsed = TaskSchema.safeParse(TASK_2_0_0);

    expect(parsed.success).toBe(true);
  });

  test("the 2.0.0 board shape parses", () => {
    const parsed = ProjectStateSchema.safeParse(BOARD_2_0_0);

    expect(parsed.success).toBe(true);
  });

  test("fields added since then arrive with a usable default", () => {
    const parsed = TaskSchema.parse(TASK_2_0_0);

    // Anything added after 2.0.0 must be readable without having been written.
    expect(parsed.attachments).toEqual([]);
  });

  test("nothing the user wrote is lost in the process", () => {
    const parsed = TaskSchema.parse(TASK_2_0_0);

    expect(parsed.title).toBe(TASK_2_0_0.title);
    expect(parsed.body).toBe(TASK_2_0_0.body);
    expect(parsed.status).toBe("queued");
  });
});

describe("a board from a later release does not crash this one", () => {
  /**
   * Someone rolls back, or runs an older build against a board a newer one
   * wrote. It must still open — but the unknown fields are dropped on the next
   * write, so this is lossy by design rather than by accident.
   */
  test("unknown fields are tolerated rather than rejected", () => {
    const fromTheFuture = {
      ...BOARD_2_0_0,
      labels: ["something-new"],
      tasks: [{ ...TASK_2_0_0, priority: "P1", assignee: "someone" }],
    };

    expect(ProjectStateSchema.safeParse(fromTheFuture).success).toBe(true);
  });
});

describe("what still counts as unreadable", () => {
  /**
   * Tolerance has a floor. A board missing something the product cannot work
   * without is a genuine error, and saying so beats guessing.
   */
  test("a task with no id is rejected", () => {
    const { id: _id, ...noId } = TASK_2_0_0;

    expect(TaskSchema.safeParse(noId).success).toBe(false);
  });

  test("a task with an unknown status is rejected", () => {
    expect(TaskSchema.safeParse({ ...TASK_2_0_0, status: "invented" }).success).toBe(false);
  });

  test("a board with no tasks array is rejected", () => {
    const { tasks: _tasks, ...noTasks } = BOARD_2_0_0;

    expect(ProjectStateSchema.safeParse(noTasks).success).toBe(false);
  });
});
