import { arrayMove } from "@dnd-kit/sortable";
import type { Task, TaskStatus } from "../api.ts";

/**
 * Where a dragged card ends up.
 *
 * Cards sort by `order`, so placing one between two neighbours means giving it
 * an order between theirs — the midpoint. Order is a real number precisely so
 * this always has an answer; with integers there is nothing between 1 and 2 and
 * every insert would mean renumbering the column.
 */

/** The tasks of one column, in display order. */
export function columnTasks(tasks: Task[], status: TaskStatus, excludeId?: string): Task[] {
  return tasks
    .filter((t) => t.status === status && t.id !== excludeId)
    .sort((a, b) => a.order - b.order);
}

export interface Drop {
  status: TaskStatus;
  order: number;
}

/**
 * Resolves a hover or a drop into the column and position the card will take.
 *
 * Within a column this follows sortable semantics rather than "insert before
 * whatever is under the cursor": dragging *down* onto a card lands after it,
 * dragging *up* lands before it. That is what the preview animation shows, and
 * a drop that disagreed with the preview is the thing that makes a board feel
 * broken.
 *
 * Always computed against the server's state, never against a previous preview,
 * so repeated hovers cannot compound into a drift.
 */
export function planDrop(
  tasks: Task[],
  activeId: string,
  overId: string,
  columns: readonly TaskStatus[],
): Drop | null {
  const active = tasks.find((t) => t.id === activeId);
  if (!active) return null;

  const overTask = tasks.find((t) => t.id === overId);
  const status = (columns as readonly string[]).includes(overId)
    ? (overId as TaskStatus)
    : overTask?.status;
  if (!status) return null;

  if (status === active.status) {
    // Reorder: let the array tell us where the card lands, so direction counts.
    const list = columnTasks(tasks, status);
    const from = list.findIndex((t) => t.id === activeId);
    const to = overTask ? list.findIndex((t) => t.id === overId) : list.length - 1;
    if (from === -1 || to === -1) return null;

    const moved = arrayMove(list, from, to);
    const index = moved.findIndex((t) => t.id === activeId);
    return { status, order: between(moved[index - 1]?.order, moved[index + 1]?.order) };
  }

  // Cross-column: take the hovered card's slot, or append when dropped on the
  // column itself (empty space below the last card, or an empty column).
  const list = columnTasks(tasks, status, activeId);
  const index = overTask ? list.findIndex((t) => t.id === overId) : list.length;
  const at = index === -1 ? list.length : index;
  return { status, order: between(list[at - 1]?.order, list[at]?.order) };
}

/** A position between two neighbours, or just outside a single one. */
function between(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}
