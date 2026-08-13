import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Task } from "../api.ts";
import type { ColumnSpec } from "../lib/columns.ts";
import { Card } from "./Card.tsx";

export function Column({
  spec,
  tasks,
  showEmptyCopy,
  isTarget,
  onAdd,
  onOpen,
}: {
  spec: ColumnSpec;
  tasks: Task[];
  /**
   * Whether an empty column explains itself. Only some do: a board where every
   * empty column shouts advice is noisier than one that stays quiet until the
   * guidance is actually useful.
   */
  showEmptyCopy: boolean;
  /**
   * Whether a held card would land here. Taken from the resolved drop rather
   * than useDroppable's isOver, because once the cursor is over a card dnd-kit
   * reports that card as the target and the column would stop highlighting
   * exactly when the user is aiming most carefully.
   */
  isTarget: boolean;
  onAdd: (spec: ColumnSpec) => void;
  onOpen: (task: Task) => void;
}) {
  // The column itself is a drop target so an empty column — or the space below
  // the last card — still accepts a drop.
  const { setNodeRef } = useDroppable({ id: spec.status, data: { status: spec.status } });

  return (
    <section className={`cc-column${isTarget ? " cc-column--over" : ""}`}>
      <div className="cc-column__head">
        <span className="cc-dot" style={{ background: spec.color }} />
        <span className="cc-column__name">{spec.label}</span>
        <span className="cc-column__count">{tasks.length}</span>
        <div style={{ flex: "1 1 0%" }} />
        <button
          type="button"
          className="cc-iconbtn cc-iconbtn--bare cc-iconbtn--xs"
          aria-label={`Add task to ${spec.label}`}
          title={`Add task to ${spec.label}`}
          onClick={() => onAdd(spec)}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="cc-column__list" ref={setNodeRef}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.length === 0
            ? showEmptyCopy && (
                <div className="cc-empty">
                  <div className="cc-empty__title">{spec.empty.title}</div>
                  <div className="cc-empty__text">{spec.empty.text}</div>
                  {spec.empty.prompt && <div className="cc-empty__prompt">{spec.empty.prompt}</div>}
                </div>
              )
            : tasks.map((task) => <Card key={task.id} task={task} onOpen={onOpen} />)}
        </SortableContext>
      </div>
    </section>
  );
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "0 0 auto", display: "block" }}
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}
