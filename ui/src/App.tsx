import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { planDrop } from "./lib/placement.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchState,
  newTaskId,
  sendEvent,
  subscribe,
  uploadAttachment,
  type Connection,
  type ProjectState,
  type Task,
  type TaskStatus,
} from "./api.ts";
import { Column } from "./components/Column.tsx";
import { DraggedCard } from "./components/Card.tsx";
import { Header } from "./components/Header.tsx";
import { NewTaskDialog } from "./components/NewTaskDialog.tsx";
import { TaskDialog } from "./components/TaskDialog.tsx";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { NewTaskButton } from "./components/NewTaskButton.tsx";
import { COLUMNS, COLUMN_STATUSES, type ColumnSpec } from "./lib/columns.ts";
import { useShortcuts, type Shortcut } from "./lib/shortcuts.ts";

type Theme = "light" | "dark";

export function App() {
  const [state, setState] = useState<ProjectState | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [rejection, setRejection] = useState<string | null>(null);
  const [composing, setComposing] = useState<ColumnSpec | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [dragging, setDragging] = useState<Task | null>(null);
  // Only which column is being aimed at — deliberately not a full preview of
  // the rearranged board. Re-rendering cards into another column mid-drag makes
  // dnd-kit re-measure every node underneath the cursor, and the drag visibly
  // stutters. Toggling one class does not move anything, so it is free.
  const [target, setTarget] = useState<TaskStatus | null>(null);
  const boardRef = useRef<HTMLElement>(null);
  const savedScroll = useRef(0);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cc-theme", theme);
  }, [theme]);

  // The stream carries every change, including ones Claude makes in its own
  // process, so it is the only thing keeping this board current.
  useEffect(() => subscribe(setState, setConnection), []);

  const reload = useCallback(async () => {
    setConnection("connecting");
    try {
      setState(await fetchState());
      setConnection("live");
    } catch {
      setConnection("lost");
    }
  }, []);

  const apply = useCallback(async (event: Parameters<typeof sendEvent>[0]) => {
    const result = await sendEvent(event);
    if (result.ok) {
      setState(result.state);
      setRejection(null);
    } else {
      // Core owns the wording — it explains the rule that was broken.
      setRejection(result.error.message);
    }
  }, []);

  /**
   * Files are staged in the dialog because a new task has no id yet, and an
   * attachment needs one. The task is created first, then each file is uploaded
   * against it; a failed upload reports itself without losing the task.
   */
  const createTask = useCallback(
    async (draft: { title: string; body: string; planMode: boolean; status: TaskStatus; files: File[] }) => {
      const id = newTaskId();
      const created = await sendEvent({
        type: "create",
        id,
        title: draft.title,
        body: draft.body,
        planMode: draft.planMode,
        status: draft.status,
      });

      if (!created.ok) {
        setRejection(created.error.message);
        return;
      }
      setState(created.state);

      for (const file of draft.files) {
        const uploaded = await uploadAttachment(id, file);
        if (uploaded.ok) setState(uploaded.state);
        else setRejection(uploaded.error.message);
      }
    },
    [],
  );

  const byStatus = useMemo(() => {
    const grouped = new Map<TaskStatus, Task[]>();
    for (const task of state?.tasks ?? []) {
      const list = grouped.get(task.status) ?? [];
      list.push(task);
      grouped.set(task.status, list);
    }
    for (const list of grouped.values()) list.sort((a, b) => a.order - b.order);
    return grouped;
  }, [state]);

  /**
   * Board shortcuts. One entry per key; the guards against typing and modified
   * presses live in the hook, so adding the next one is a line here.
   *
   * A new task always starts in Backlog: the shortcut is for capturing
   * something before it is lost, and deciding where it belongs comes after.
   */
  const shortcuts = useMemo<Shortcut[]>(
    () => [
      {
        key: "n",
        label: "New task",
        run: () => setComposing(COLUMNS[0]!),
      },
    ],
    [],
  );

  // Silenced while a dialog is open — the keyboard is talking to that, not the
  // board behind it.
  const dialogOpen = composing !== null || opened !== null || deleting !== null;
  useShortcuts(shortcuts, !dialogOpen);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicking a card still works.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Dragging is the only way to move a task on the board, so it cannot be
    // mouse-only: focus a card, Space to lift, arrows to move, Space to drop.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (event: DragStartEvent) => {
    const task = state?.tasks.find((t) => t.id === String(event.active.id)) ?? null;
    setDragging(task);
    setTarget(task?.status ?? null);
    savedScroll.current = boardRef.current?.scrollLeft ?? 0;
  };

  // Track the aimed-at column only. dnd-kit reports the card under the cursor
  // rather than its column, so the column has to be derived — otherwise the
  // highlight goes out exactly when the cursor is over a card.
  const onDragOver = (event: DragOverEvent) => {
    if (!state || !event.over) return;
    const plan = planDrop(state.tasks, String(event.active.id), String(event.over.id), COLUMN_STATUSES);
    if (plan) setTarget(plan.status);
  };

  const endDrag = () => {
    setDragging(null);
    setTarget(null);
    // Removing the overlay reflows the board; without this the horizontal
    // scroll jumps back to the start on every drop.
    const scroll = boardRef.current?.scrollLeft ?? savedScroll.current;
    setTimeout(() => {
      if (boardRef.current) boardRef.current.scrollLeft = scroll;
    }, 0);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    const task = state?.tasks.find((t) => t.id === id);
    const landing = event.over
      ? planDrop(state?.tasks ?? [], id, String(event.over.id), COLUMN_STATUSES)
      : null;
    endDrag();

    if (!task || !landing) return;
    if (landing.status === task.status && landing.order === task.order) return;

    // One event either way: `move` carries the position, so a cross-column drop
    // lands exactly where it was dropped rather than at whatever index its old
    // order happened to imply.
    void apply(
      landing.status === task.status
        ? { type: "reorder", id, order: landing.order }
        : { type: "move", id, to: landing.status, order: landing.order },
    );
  };

  if (!state) {
    return (
      <div className="cc-app">
        <div className="cc-empty" style={{ margin: "auto" }}>
          <div className="cc-empty__title">
            {connection === "lost" ? "Can't reach the board server" : "Loading the board…"}
          </div>
          {connection === "lost" && (
            <button type="button" className="cc-btn cc-btn--secondary" onClick={reload}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const total = state.tasks.length;

  return (
    <div className="cc-app" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Header
        cwd={state.cwd}
        connection={connection}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onNewTask={() => setComposing(COLUMNS[0]!)}
        newTaskHint="N"
      />

      <div className="cc-bar">
        <span style={{ font: "var(--type-page-title)" }}>Task Board</span>
        <span style={{ font: "var(--type-meta)", color: "var(--ink-3)" }}>
          {total === 0
            ? "Nothing on the board yet"
            : `${total} task${total === 1 ? "" : "s"} · drag a card to move it between columns`}
        </span>
        <div style={{ flex: "1 1 0%" }} />
      </div>

      {connection === "lost" && <ServerLost onRetry={reload} />}
      {rejection && <Rejected message={rejection} onDismiss={() => setRejection(null)} />}

      <DndContext
        sensors={sensors}
        // Corners rather than centres: with tall cards, the pointer is often
        // past a card's centre while still clearly above it.
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragCancel={endDrag}
        onDragEnd={onDragEnd}
      >
        <main
          ref={boardRef}
          style={{
            display: "flex",
            gap: "var(--column-gap)",
            padding: "var(--board-gutter)",
            overflowX: "auto",
            flex: "1 1 auto",
            alignItems: "flex-start",
            opacity: connection === "lost" ? 0.55 : 1,
          }}
        >
          {COLUMNS.map((spec) => (
            <Column
              key={spec.status}
              spec={spec}
              tasks={byStatus.get(spec.status) ?? []}
              // Backlog explains itself only on a brand-new board; Queue always
              // does, because that is where the working loop actually starts.
              showEmptyCopy={
                (spec.status === "backlog" && total === 0) || spec.status === "queued"
              }
              isTarget={dragging !== null && target === spec.status}
              onAdd={setComposing}
              onOpen={(task) => setOpened(task.id)}
              // Stopping is a move back to the queue: the work is abandoned,
              // not finished, and the task stays available to start again.
              onStop={(task) => void apply({ type: "move", id: task.id, to: "queued" })}
              onDelete={setDeleting}
            />
          ))}
        </main>

        {/* The held card follows the cursor; the original stays in place, faded,
            so the board never collapses under you mid-drag. */}
        {/* No drop animation. dnd-kit's default flies the overlay back to the
            original node's position, but after a move that node has already
            been re-rendered somewhere else — the card visibly darts to the
            wrong place before snapping. Releasing instantly reads as correct. */}
        <DragOverlay dropAnimation={null}>
          {dragging ? <DraggedCard task={dragging} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Read from live state, not a snapshot, so an open task keeps up with
          changes Claude makes while you are looking at it. */}
      {opened && state.tasks.some((t) => t.id === opened) && (
        <TaskDialog
          task={state.tasks.find((t) => t.id === opened)!}
          onClose={() => setOpened(null)}
          onEvent={(event) => void apply(event)}
          onAttachmentsChanged={() => void reload()}
        />
      )}

      <NewTaskButton onClick={() => setComposing(COLUMNS[0]!)} />

      {deleting && (
        <ConfirmDialog
          title="Delete this task?"
          detail={`"${deleting.title}" and any files attached to it will be removed. This cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void apply({ type: "delete", id: deleting.id });
            setDeleting(null);
          }}
        />
      )}

      {composing && (
        <NewTaskDialog
          status={composing.status}
          columnLabel={composing.label}
          onCancel={() => setComposing(null)}
          onCreate={({ title, body, planMode, status, files }) => {
            setComposing(null);
            void createTask({ title, body, planMode, status, files });
          }}
        />
      )}
    </div>
  );
}

/**
 * The board is a view of a server on this machine. When that server stops
 * answering, the board is frozen rather than empty — saying so is the whole
 * point, because a silently stale board is worse than an obviously broken one.
 */
function ServerLost({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="cc-alert cc-alert--danger" style={{ margin: "0 var(--board-gutter)" }}>
      <div className="cc-alert__body">
        <strong>Lost the local server.</strong> The board below is frozen and no longer updating.
        <div className="cc-alert__detail">
          Relaunch Claude in this project, or run <code>cmc cleanup</code> and reload.
        </div>
      </div>
      <button type="button" className="cc-btn cc-btn--secondary cc-btn--sm" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function Rejected({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="cc-alert cc-alert--warning" style={{ margin: "0 var(--board-gutter)" }}>
      <div className="cc-alert__body">{message}</div>
      <button type="button" className="cc-btn cc-btn--quiet cc-btn--sm" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function initialTheme(): Theme {
  const saved = localStorage.getItem("cc-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
