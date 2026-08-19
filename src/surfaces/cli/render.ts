import type { ProjectState, Task, TaskStatus } from "../../core/types.ts";

/** Human-facing output. The --json paths never come through here. */

const COLUMNS: TaskStatus[] = ["backlog", "queued", "in-progress", "awaiting-review", "done", "skipped"];

const LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  queued: "Queued",
  "in-progress": "In progress",
  "awaiting-review": "Awaiting review",
  done: "Done",
  skipped: "Skipped",
};

export function renderBoard(state: ProjectState): string {
  if (state.tasks.length === 0) {
    return [
      "The board is empty.",
      "",
      "Add a task:   cmc add \"Fix the thing\"",
      "Queue it:     cmc add \"Fix the thing\" --queued",
    ].join("\n");
  }

  const lines: string[] = [];
  for (const status of COLUMNS) {
    const tasks = state.tasks.filter((t) => t.status === status).sort((a, b) => a.order - b.order);
    if (tasks.length === 0) continue;

    lines.push(`${LABEL[status]} (${status}) — ${tasks.length}`);
    for (const task of tasks) lines.push(`  ${shortId(task.id)}  ${task.title}${suffix(task)}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function suffix(task: Task): string {
  const bits: string[] = [];
  if (task.planMode) bits.push("plan mode");
  if (task.attempts > 1) bits.push(`attempt ${task.attempts}`);
  return bits.length ? `  (${bits.join(", ")})` : "";
}

export function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 10) : id.padEnd(10);
}

/** What Claude receives when a task starts: the body, plus how to work it. */
export function renderTaskForClaude(task: Task): string {
  const sections = [`Task: ${task.title} (${task.id})`, ""];

  if (task.planMode) {
    sections.push(
      "Plan mode is enabled for this task. Before making any changes, analyze the request, " +
        "review the relevant code, then present a concrete plan and wait for approval.",
      "",
      "---",
      "",
    );
  }

  sections.push(task.body || "(no description)");

  // The slash command already says to run `finish`, but that is read once and
  // then buried under however much work the task takes. This payload is the
  // last thing the agent sees before starting, so it carries the next step too.
  sections.push(
    "",
    "---",
    "",
    "When the work is done, run `cmc finish` to move this to awaiting review, " +
      "then wait for the user's verdict rather than starting the next task.",
  );

  return sections.join("\n");
}
