import {
  EventSchema,
  TERMINAL_STATUSES,
  activeTask,
  type DomainError,
  type Effect,
  type Event,
  type ParsedEvent,
  type ProjectState,
  type Result,
  type Task,
  type TaskStatus,
} from "./types.ts";

/**
 * The only way project state changes.
 *
 * Pure and total: no clock, no randomness, no I/O, and it never throws — a
 * rejection is a value, so callers cannot ignore one by accident. Timestamps and
 * ids arrive on the event, which is what keeps it deterministic under test.
 *
 * The transition table this implements is in docs/architecture.md.
 */
export function apply(state: ProjectState, event: Event): Result {
  const parsed = EventSchema.safeParse(event);
  if (!parsed.success) {
    return reject("E_INVALID_INPUT", describeParseFailure(parsed.error.issues[0]));
  }
  const e = parsed.data;

  switch (e.type) {
    case "create":
      return applyCreate(state, e);
    case "move":
      return applyMove(state, e);
    case "update":
      return applyUpdate(state, e);
    case "delete":
      return applyDelete(state, e);
    case "reorder":
      return applyReorder(state, e);
    case "advance":
      return applyAdvance(state, e);
    case "finish":
      return applyFinish(state, e);
    case "approve":
      return applyApprove(state, e);
    case "revise":
      return applyRevise(state, e);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function applyCreate(state: ProjectState, e: Extract<ParsedEvent, { type: "create" }>): Result {
  if (state.tasks.some((t) => t.id === e.id)) {
    return reject("E_DUPLICATE_ID", `A task with id "${e.id}" already exists.`, e.id);
  }
  if (e.status === "in-progress") {
    const active = activeTask(state);
    if (active) return conflict(active);
  }

  const task: Task = {
    id: e.id,
    title: e.title,
    body: e.body,
    status: e.status,
    order: nextOrder(state, e.status),
    createdAt: e.at,
    startedAt: e.status === "in-progress" ? e.at : null,
    finishedAt: TERMINAL_STATUSES.includes(e.status) ? e.at : null,
    attempts: e.status === "in-progress" ? 1 : 0,
    planMode: e.planMode,
    sessionId: null,
  };

  const next = commit(state, [...state.tasks, task], e.at);
  return ok(next, task.status === "in-progress" ? [{ type: "task-started", task }] : []);
}



function applyMove(state: ProjectState, e: Extract<ParsedEvent, { type: "move" }>): Result {
  const task = state.tasks.find((t) => t.id === e.id);
  if (!task) return notFound(e.id);
  // Same column: only a new position is a real change. Without this, a drop
  // that reorders within a column would be swallowed by the no-op guard.
  if (task.status === e.to) {
    if (e.order === undefined || e.order === task.order) return ok(state, []);
    return ok(commit(state, replace(state.tasks, { ...task, order: e.order }), e.at), []);
  }

  if (e.to === "in-progress") {
    const active = activeTask(state);
    if (active && active.id !== task.id) return conflict(active);
  }

  // A drop carries a position; a status change on its own does not.
  const placed = transition(task, e.to, e.at);
  const moved = e.order === undefined ? placed : { ...placed, order: e.order };
  const tasks = replace(state.tasks, moved);
  return ok(commit(state, tasks, e.at), [...effectsForMove(moved), ...emptiedIfDrained(state, tasks)]);
}






function applyUpdate(state: ProjectState, e: Extract<ParsedEvent, { type: "update" }>): Result {
  const task = state.tasks.find((t) => t.id === e.id);
  if (!task) return notFound(e.id);

  const updated: Task = {
    ...task,
    title: e.title ?? task.title,
    body: e.body ?? task.body,
    planMode: e.planMode ?? task.planMode,
  };
  if (sameContent(task, updated)) return ok(state, []);

  return ok(commit(state, replace(state.tasks, updated), e.at), []);
}

function applyDelete(state: ProjectState, e: Extract<ParsedEvent, { type: "delete" }>): Result {
  if (!state.tasks.some((t) => t.id === e.id)) return notFound(e.id);

  const tasks = state.tasks.filter((t) => t.id !== e.id);
  return ok(commit(state, tasks, e.at), emptiedIfDrained(state, tasks));
}

function applyReorder(state: ProjectState, e: Extract<ParsedEvent, { type: "reorder" }>): Result {
  const task = state.tasks.find((t) => t.id === e.id);
  if (!task) return notFound(e.id);
  if (task.order === e.order) return ok(state, []);

  return ok(commit(state, replace(state.tasks, { ...task, order: e.order }), e.at), []);
}

function applyAdvance(state: ProjectState, e: Extract<ParsedEvent, { type: "advance" }>): Result {
  const active = activeTask(state);
  if (active) {
    return reject(
      "E_ALREADY_ACTIVE",
      `"${active.title}" is already in progress. Finish it before starting another.`,
      active.id,
    );
  }

  const next = [...state.tasks]
    .filter((t) => t.status === "queued")
    .sort((a, b) => a.order - b.order)[0];
  if (!next) return reject("E_EMPTY_QUEUE", "Nothing is queued, so there is nothing to start.");

  const started: Task = { ...transition(next, "in-progress", e.at), sessionId: e.sessionId };
  const tasks = replace(state.tasks, started);
  return ok(commit(state, tasks, e.at), [
    { type: "task-started", task: started },
    ...emptiedIfDrained(state, tasks),
  ]);
}

function applyFinish(state: ProjectState, e: Extract<ParsedEvent, { type: "finish" }>): Result {
  const active = activeTask(state);
  if (!active) {
    return reject("E_NO_ACTIVE_TASK", "No task is in progress, so there is nothing to finish.");
  }

  const finished = transition(active, "awaiting-review", e.at);
  return ok(commit(state, replace(state.tasks, finished), e.at), [
    { type: "task-finished", task: finished },
  ]);
}

function applyApprove(state: ProjectState, e: Extract<ParsedEvent, { type: "approve" }>): Result {
  const review = oldestAwaitingReview(state);
  if (!review) return reject("E_NOTHING_TO_REVIEW", "No task is awaiting review.");

  const approved = transition(review, "done", e.at);
  return ok(commit(state, replace(state.tasks, approved), e.at), [
    { type: "task-approved", task: approved },
  ]);
}

function applyRevise(state: ProjectState, e: Extract<ParsedEvent, { type: "revise" }>): Result {
  const review = oldestAwaitingReview(state);
  if (!review) return reject("E_NOTHING_TO_REVIEW", "No task is awaiting review.");

  const active = activeTask(state);
  if (active) return conflict(active);

  const revised = transition(review, "in-progress", e.at);
  return ok(commit(state, replace(state.tasks, revised), e.at), [
    { type: "task-revised", task: revised },
  ]);
}

// ---------------------------------------------------------------------------
// Transition mechanics
// ---------------------------------------------------------------------------

/** The field effects of entering a status — the second table in architecture.md. */
function transition(task: Task, to: TaskStatus, at: number): Task {
  switch (to) {
    case "backlog":
    case "queued":
      return { ...task, status: to, startedAt: null, finishedAt: null };
    case "in-progress":
      return { ...task, status: to, startedAt: at, finishedAt: null, attempts: task.attempts + 1 };
    case "awaiting-review":
      return { ...task, status: to, finishedAt: at };
    case "done":
    case "skipped":
      return { ...task, status: to, finishedAt: task.finishedAt ?? at };
  }
}

function effectsForMove(task: Task): Effect[] {
  switch (task.status) {
    case "in-progress":
      return [{ type: "task-started", task }];
    case "awaiting-review":
      return [{ type: "task-finished", task }];
    case "done":
      return [{ type: "task-approved", task }];
    default:
      return [];
  }
}

/** Emitted when the last queued task leaves the queue and none remain. */
function emptiedIfDrained(before: ProjectState, after: Task[]): Effect[] {
  const had = before.tasks.some((t) => t.status === "queued");
  const has = after.some((t) => t.status === "queued");
  return had && !has ? [{ type: "queue-emptied" }] : [];
}

function oldestAwaitingReview(state: ProjectState): Task | undefined {
  return [...state.tasks]
    .filter((t) => t.status === "awaiting-review")
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))[0];
}

function nextOrder(state: ProjectState, status: TaskStatus): number {
  const orders = state.tasks.filter((t) => t.status === status).map((t) => t.order);
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

function replace(tasks: Task[], updated: Task): Task[] {
  return tasks.map((t) => (t.id === updated.id ? updated : t));
}

function sameContent(a: Task, b: Task): boolean {
  return a.title === b.title && a.body === b.body && a.planMode === b.planMode;
}

function commit(state: ProjectState, tasks: Task[], at: number): ProjectState {
  return { ...state, version: state.version + 1, updatedAt: at, tasks };
}

// ---------------------------------------------------------------------------
// Result constructors
// ---------------------------------------------------------------------------

function ok(state: ProjectState, effects: Effect[]): Result {
  return { ok: true, state, effects };
}

function reject(code: DomainError["code"], message: string, taskId?: string): Result {
  return { ok: false, error: taskId ? { code, message, taskId } : { code, message } };
}

function notFound(id: string): Result {
  return reject("E_TASK_NOT_FOUND", `No task with id "${id}".`, id);
}

function conflict(active: Task): Result {
  return reject(
    "E_CONFLICT",
    `"${active.title}" is already in progress. Move or finish it first — only one task runs at a time.`,
    active.id,
  );
}

function describeParseFailure(issue: { path: PropertyKey[]; message: string } | undefined): string {
  if (!issue) return "The event was not valid.";
  const field = issue.path.length > 0 ? issue.path.join(".") : "event";
  return `Invalid ${field}: ${issue.message.toLowerCase()}.`;
}
