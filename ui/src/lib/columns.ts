import type { TaskStatus } from "../api.ts";

/**
 * The board's columns.
 *
 * Five of the six statuses get a column; `skipped` deliberately does not. It is
 * a real state a task can be moved to, but it is an outcome rather than a stage
 * of work, and giving it a permanent column would put a mostly-empty dead end
 * next to the live queue. The design agrees — it ships a `--col-skipped` token
 * but no skipped column.
 */
export interface ColumnSpec {
  status: TaskStatus;
  label: string;
  /** The design's per-column accent token. */
  color: string;
  /** A wash of the same hue, for filled status pills. */
  soft: string;
  /**
   * Whether a task can be put here by hand — dragged in, or created with the
   * column's + button.
   *
   * Only the two columns that hold work *waiting* to happen. Everything to the
   * right is a record of what the workflow did: a task reaches in-progress by
   * being advanced, review by being finished, and done by being approved.
   * Dropping a card into one of those would claim something that never
   * happened.
   */
  accepts: boolean;
  /** Shown when the column has nothing in it. */
  empty: { title: string; text: string; prompt?: string };
}

/** Board columns as ids, for resolving what a drop landed on. */
export const COLUMN_STATUSES: readonly TaskStatus[] = [
  "backlog",
  "queued",
  "in-progress",
  "awaiting-review",
  "done",
];

export const COLUMNS: ColumnSpec[] = [
  {
    status: "backlog",
    accepts: true,
    label: "Backlog",
    color: "var(--col-backlog)",
    soft: "var(--hover)",
    empty: {
      title: "No tasks yet",
      text: "Ask Claude to seed the backlog from a plan, or add the first task by hand.",
      prompt: "Read PLAN.md and add each work item to the Command Center backlog.",
    },
  },
  {
    status: "queued",
    accepts: true,
    label: "Queue",
    color: "var(--col-queue)",
    soft: "var(--info-soft)",
    empty: {
      title: "Nothing queued",
      text: "Drop tasks here, then run /command-center:start in Claude.",
    },
  },
  {
    status: "in-progress",
    accepts: false,
    label: "In Progress",
    color: "var(--col-progress)",
    soft: "var(--orange-wash-2)",
    empty: {
      title: "Nothing in progress",
      text: "Claude works one task at a time. Starting a task moves it here.",
    },
  },
  {
    status: "awaiting-review",
    accepts: false,
    label: "In Review",
    color: "var(--col-review)",
    soft: "var(--warning-soft)",
    empty: {
      title: "Nothing to review",
      text: "Finished work lands here for you to approve or send back.",
    },
  },
  {
    status: "done",
    accepts: false,
    label: "Done",
    color: "var(--col-done)",
    soft: "var(--success-soft)",
    empty: { title: "Nothing finished yet", text: "Approved tasks collect here." },
  },
];
