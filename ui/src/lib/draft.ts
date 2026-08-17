import type { Task } from "../api.ts";
import type { Draft } from "../components/TaskEditForm.tsx";

/**
 * Does this draft differ from the task it was opened from?
 *
 * Compared against what a save would actually send, not against the raw field
 * values — the dialog trims title and body before committing, so trailing
 * whitespace is not a change. A warning that fires on a stray space is a
 * warning the user learns to click through.
 */
export function isDirty(task: Task, draft: Draft): boolean {
  return (
    draft.title.trim() !== task.title ||
    draft.body.trim() !== task.body ||
    draft.planMode !== task.planMode
  );
}
