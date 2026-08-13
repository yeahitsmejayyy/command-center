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
    label: "Backlog",
    color: "var(--col-backlog)",
    empty: {
      title: "No tasks yet",
      text: "Ask Claude to seed the backlog from a plan, or add the first task by hand.",
      prompt: "Read PLAN.md and add each work item to the Command Center backlog.",
    },
  },
  {
    status: "queued",
    label: "Queue",
    color: "var(--col-queue)",
    empty: {
      title: "Nothing queued",
      text: "Drop tasks here, then run /command-center:start in Claude.",
    },
  },
  {
    status: "in-progress",
    label: "In Progress",
    color: "var(--col-progress)",
    empty: {
      title: "Nothing in progress",
      text: "Claude works one task at a time. Starting a task moves it here.",
    },
  },
  {
    status: "awaiting-review",
    label: "In Review",
    color: "var(--col-review)",
    empty: {
      title: "Nothing to review",
      text: "Finished work lands here for you to approve or send back.",
    },
  },
  {
    status: "done",
    label: "Done",
    color: "var(--col-done)",
    empty: { title: "Nothing finished yet", text: "Approved tasks collect here." },
  },
];
