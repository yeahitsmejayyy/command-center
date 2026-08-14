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

/** The active task is derived, never stored — v1 kept both and had to sync them. */
export function activeTask(state: ProjectState): Task | undefined {
  return state.tasks.find((t) => t.status === "in-progress");
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const base = { at: z.number().int().nonnegative() };

export const EventSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
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
    type: z.literal("move"),
    id: z.string().min(1),
    to: TaskStatusSchema,
    /** Where in the destination column. Omitted, the task keeps its position. */
    order: z.number().optional(),
  }),
  z.object({ ...base, type: z.literal("reorder"), id: z.string().min(1), order: z.number() }),
  z.object({ ...base, type: z.literal("advance"), sessionId: z.string().nullable().default(null) }),
  z.object({ ...base, type: z.literal("finish") }),
  z.object({ ...base, type: z.literal("approve") }),
  z.object({ ...base, type: z.literal("revise") }),
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
