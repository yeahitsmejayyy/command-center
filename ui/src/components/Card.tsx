import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "../api.ts";
import { relativeTime, shortId } from "../lib/format.ts";
import { CardAction, StopIcon, TrashIcon } from "./CardAction.tsx";

/**
 * A task card.
 *
 * The design's card also carries a priority chip and a human assignee. We ship
 * neither field, so the card renders what the model actually has: the id, the
 * title, an excerpt, and who last touched it — which is Claude whenever a
 * session worked the task.
 */
export function Card({
  task,
  onOpen,
  onStop,
  onDelete,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  onStop: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
  });

  return (
    <CardBody
      task={task}
      onOpen={onOpen}
      onStop={onStop}
      onDelete={onDelete}
      nodeRef={setNodeRef}
      className={isDragging ? "cc-card cc-card--dragging" : "cc-card"}
      style={{
        // The neighbours slide out of the way as you drag past them; this is
        // what shows where the card will land before you let go.
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      handleProps={{ ...listeners, ...attributes }}
    />
  );
}

/**
 * The card as it looks while held: lifted off the board and tilted a couple of
 * degrees, so the thing under the cursor reads as picked up rather than as a
 * copy that happens to be moving.
 */
export function DraggedCard({ task }: { task: Task }) {
  return (
    <CardBody
      task={task}
      onOpen={() => {}}
      onStop={() => {}}
      onDelete={() => {}}
      className="cc-card cc-card--held"
      style={{ transform: "rotate(2deg) scale(1.02)", cursor: "grabbing" }}
    />
  );
}

interface CardBodyProps {
  task: Task;
  onOpen: (task: Task) => void;
  onStop: (task: Task) => void;
  onDelete: (task: Task) => void;
  className: string;
  style?: React.CSSProperties;
  handleProps?: Record<string, unknown>;
  /**
   * Deliberately not called `ref`. React 18 treats `ref` as a reserved prop and
   * strips it before it reaches a function component, so naming it that meant
   * dnd-kit's setNodeRef silently never attached — the draggable existed with
   * no DOM node to measure, and nothing could be picked up.
   */
  nodeRef?: (node: HTMLElement | null) => void;
}

function CardBody({ task, onOpen, onStop, onDelete, className, style, handleProps, nodeRef }: CardBodyProps) {
  const touchedAt = task.finishedAt ?? task.startedAt ?? task.createdAt;
  const worked = task.sessionId !== null || task.attempts > 0;

  return (
    <article
      ref={nodeRef}
      className={className}
      style={style}
      onClick={() => onOpen(task)}
      {...handleProps}
    >
      <div className="cc-card__top">
        <span className="cc-id">{shortId(task.id)}</span>
        <div style={{ flex: "1 1 0%" }} />
        {task.status === "in-progress" ? (
          <CardAction label="Stop work" tone="danger" onAct={() => onStop(task)}>
            <StopIcon />
          </CardAction>
        ) : (
          <CardAction label="Delete" tone="warn" onAct={() => onDelete(task)}>
            <TrashIcon />
          </CardAction>
        )}
      </div>

      <div className="cc-card__title">{task.title}</div>
      {task.body && <div className="cc-card__desc">{task.body}</div>}

      <div className="cc-card__foot">
        {worked && (
          <>
            <span className="cc-avatar cc-avatar--agent" title="Claude" aria-label="Claude">
              CC
            </span>
            <span className="cc-card__who">Claude</span>
          </>
        )}
        <div style={{ flex: "1 1 0%" }} />
        {task.planMode && (
          <span className="cc-badge" title="Claude plans before changing anything">
            Plan
          </span>
        )}
        <span className="cc-card__when">{relativeTime(touchedAt)}</span>
      </div>
    </article>
  );
}
