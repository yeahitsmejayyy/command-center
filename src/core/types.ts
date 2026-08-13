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

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  body: z.string(),
  status: TaskStatusSchema,
  order: z.number().int(),
  createdAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable(),
  finishedAt: z.number().int().nonnegative().nullable(),
  attempts: z.number().int().nonnegative(),
  planMode: z.boolean(),
  sessionId: z.string().nullable(),
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
  z.object({ ...base, type: z.literal("move"), id: z.string().min(1), to: TaskStatusSchema }),
  z.object({ ...base, type: z.literal("reorder"), id: z.string().min(1), order: z.number().int() }),
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
