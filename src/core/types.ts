import { z } from "zod";

/**
 * Domain types. Zod schemas are the single definition; TS types are inferred.
 * State read off disk is untrusted, so the schema is what makes it a ProjectState.
 */

export const TaskStatusSchema = z.enum([
  "backlog",
  "queued",
  "in-progress",
  "awaiting-review",
  "done",
  "skipped",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** Statuses that carry a finishedAt. */
export const TERMINAL_STATUSES: readonly TaskStatus[] = ["awaiting-review", "done", "skipped"];

/**
 * Statuses where a task's content is still the user's to change.
 *
 * Once work starts, the instructions are the brief Claude was handed — editing
 * them underneath a running session means the task on the board is no longer
 * the task being worked, and nothing would say so. Past that, a finished task's
 * content is the record of what was actually done. Reopen it to edit it.
 */
export const EDITABLE_STATUSES: readonly TaskStatus[] = ["backlog", "queued"];

/**
 * A file that travels with a task.
 *
 * The bytes live on disk next to the rest of the project's state; the task only
 * carries the metadata, so reading the board never means reading attachments.
 */
export const AttachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  addedAt: z.number().int().nonnegative(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  body: z.string(),
  status: TaskStatusSchema,
  // Real, not integer: dropping a card between two others needs a position
  // between their orders, and there is nothing between 1 and 2.
  order: z.number(),
  createdAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable(),
  finishedAt: z.number().int().nonnegative().nullable(),
  attempts: z.number().int().nonnegative(),
  planMode: z.boolean(),
  sessionId: z.string().nullable(),
  /**
   * Who is working this task, as named by whoever dispatched it.
   *
   * A label, deliberately not an identity: a sub-agent shares the
   * orchestrator's session id and pid, so nothing the board can observe
   * distinguishes them (ADR-004 records the probe). The orchestrator chooses
   * this string, and the board only ever displays it back.
   *
   * Defaulted so a board written before labels existed still parses.
   */
  agent: z.string().nullable().default(null),
  // Defaulted so a board written before attachments existed still parses.
  attachments: z.array(AttachmentSchema).default([]),
});
export type Task = z.infer<typeof TaskSchema>;

export const ProjectStateSchema = z.object({
  version: z.number().int().nonnegative(),
  cwd: z.string().min(1),
  updatedAt: z.number().int().nonnegative(),
  tasks: z.array(TaskSchema),
});
export type ProjectState = z.infer<typeof ProjectStateSchema>;

export function emptyState(cwd: string): ProjectState {
  return { version: 0, cwd, updatedAt: 0, tasks: [] };
}

/**
 * How many tasks may run at once before `advance` refuses.
 *
 * One keeps the behaviour every caller written before M11 relies on. The limit
 * travels on the event rather than being read here, because core has no I/O —
 * the preference is loaded at the surface and passed in.
 */
export const DEFAULT_CONCURRENCY = 1;

/** The active task is derived, never stored — v1 kept both and had to sync them. */
export function activeTask(state: ProjectState): Task | undefined {
  return state.tasks.find((t) => t.status === "in-progress");
}

/**
 * Every running task, in board order.
 *
 * Separate from `activeTask` rather than replacing it: every existing caller
 * assumes one task and reads the singular form, and quietly widening that
 * return type would break them in ways the compiler could not see.
 */
export function activeTasks(state: ProjectState): Task[] {
  return state.tasks.filter((t) => t.status === "in-progress");
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const base = { at: z.number().int().nonnegative() };

/**
 * The concurrency limit, as supplied by the caller.
 *
 * Carried on every event that can put a task into in-progress, so core can
 * check it without reading a preference file. Defaulted to 1 so that an event
 * built before M11 — or by a surface that has not been taught to pass it —
 * means exactly what it used to mean.
 */
const limit = { concurrency: z.number().int().min(1).default(DEFAULT_CONCURRENCY) };

export const EventSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    ...limit,
    type: z.literal("create"),
    id: z.string().min(1),
    title: z.string().trim().min(1),
    body: z.string().default(""),
    planMode: z.boolean().default(false),
    status: TaskStatusSchema.default("backlog"),
  }),
  z.object({
    ...base,
    type: z.literal("update"),
    id: z.string().min(1),
    title: z.string().trim().min(1).optional(),
    body: z.string().optional(),
    planMode: z.boolean().optional(),
  }),
  z.object({ ...base, type: z.literal("delete"), id: z.string().min(1) }),
  z.object({
    ...base,
    type: z.literal("attach"),
    id: z.string().min(1),
    attachment: AttachmentSchema,
  }),
  z.object({
    ...base,
    type: z.literal("detach"),
    id: z.string().min(1),
    attachmentId: z.string().min(1),
  }),
  z.object({
    ...base,
    ...limit,
    type: z.literal("move"),
    id: z.string().min(1),
    to: TaskStatusSchema,
    /** Where in the destination column. Omitted, the task keeps its position. */
    order: z.number().optional(),
  }),
  z.object({ ...base, type: z.literal("reorder"), id: z.string().min(1), order: z.number() }),
  z.object({
    ...base,
    ...limit,
    type: z.literal("advance"),
    sessionId: z.string().nullable().default(null),
    /** A caller-chosen label for whoever will work it. Not an identity. */
    agent: z.string().min(1).nullable().default(null),
  }),
  // `id` omitted keeps the historical behaviour — the verb picks its own
  // subject off the board. Supplied, it names one. Optional rather than
  // required so every caller written before this still means what it meant.
  z.object({ ...base, type: z.literal("finish"), id: z.string().min(1).optional() }),
  z.object({ ...base, type: z.literal("approve"), id: z.string().min(1).optional() }),
  z.object({ ...base, ...limit, type: z.literal("revise"), id: z.string().min(1).optional() }),
]);
export type Event = z.input<typeof EventSchema>;
type ParsedEvent = z.infer<typeof EventSchema>;
export type { ParsedEvent };

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  "E_TASK_NOT_FOUND",
  "E_DUPLICATE_ID",
  "E_INVALID_INPUT",
  "E_CONFLICT",
  "E_ALREADY_ACTIVE",
  "E_NO_ACTIVE_TASK",
  "E_NOTHING_TO_REVIEW",
  "E_EMPTY_QUEUE",
  "E_NOT_EDITABLE",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type DomainError = {
  code: ErrorCode;
  /** Written for a confused human, not for the developer who wrote it. */
  message: string;
  /** Set when the error is about a specific task. */
  taskId?: string;
};

export type Effect =
  | { type: "task-started"; task: Task }
  | { type: "task-finished"; task: Task }
  | { type: "task-approved"; task: Task }
  | { type: "task-revised"; task: Task }
  | { type: "queue-emptied" };

export type Result =
  | { ok: true; state: ProjectState; effects: Effect[] }
  | { ok: false; error: DomainError };
