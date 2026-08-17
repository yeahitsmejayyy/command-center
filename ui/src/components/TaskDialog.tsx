import { useEffect, useState } from "react";
import { attachmentUrl, isEditable, type BoardEvent, type Task, type TaskStatus } from "../api.ts";
import { fileSize, relativeTime, shortId } from "../lib/format.ts";
import { CopyButton } from "./CopyButton.tsx";
import { CloseButton } from "./CloseButton.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { TaskEditForm, type Draft } from "./TaskEditForm.tsx";
import { isDirty } from "../lib/draft.ts";
import { useTooltip } from "./Tooltip.tsx";
import { COLUMNS } from "../lib/columns.ts";

/**
 * A task, opened.
 *
 * The actions offered depend on where the task is, because that is what the
 * user can actually do next — a queued task has nothing to approve, and a
 * finished one has nothing to stop. Everything here goes through the same
 * events the CLI uses, so the board can never do something Claude cannot.
 */
export function TaskDialog({
  task,
  onClose,
  onEvent,
  onAttachmentsChanged,
}: {
  task: Task;
  onClose: () => void;
  /** Resolves false when core refused the event; the banner explains why. */
  onEvent: (event: BoardEvent) => Promise<boolean>;
  /** Uploads and removals change state outside the event stream. */
  onAttachmentsChanged: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  // Which way out the user asked for, held while they confirm losing the edit.
  // Backing out of the form and closing the dialog are different destinations,
  // so answering "discard" has to remember which one was meant.
  const [discarding, setDiscarding] = useState<null | "edit" | "dialog">(null);

  const editable = isEditable(task);
  const unsaved = editing && isDirty(task, draft);

  /** Leave the form. Asks first if there is typing to lose. */
  const requestExitEdit = () => (unsaved ? setDiscarding("edit") : setEditing(false));

  /** Leave the dialog entirely. Same question, different destination. */
  const requestClose = () => (unsaved ? setDiscarding("dialog") : onClose());

  // Claude can advance the queue while the dialog is open. Editing a task that
  // just started would be refused on save anyway, so leave edit mode when the
  // ground moves rather than letting the user keep typing into a dead form.
  useEffect(() => {
    if (!editable) {
      setEditing(false);
      setDiscarding(null);
    }
  }, [editable]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape backs out of editing first — losing the whole dialog when you
      // meant to cancel an edit throws away more than you asked it to.
      if (e.key !== "Escape") return;
      // The confirmation is on top and binds Escape itself; answering it here
      // too would cancel the question and the edit in one keypress.
      if (discarding) return;
      if (editing) requestExitEdit();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing, discarding, unsaved]);

  const column = COLUMNS.find((c) => c.status === task.status);
  const act = async (event: BoardEvent) => {
    await onEvent(event);
    onClose();
  };

  const startEditing = () => {
    setDraft({ title: task.title, body: task.body, planMode: task.planMode });
    setEditing(true);
  };

  const save = async () => {
    const title = draft.title.trim();
    if (!title) return; // core would reject it too; no need to round-trip

    // Stay in edit mode on a refusal so the text survives to be retried.
    const accepted = await onEvent({
      type: "update",
      id: task.id,
      title,
      body: draft.body.trim(),
      planMode: draft.planMode,
    });
    if (accepted) setEditing(false);
  };

  return (
    <>
      <div className="cc-overlay" onMouseDown={requestClose}>
      <div
        className="cc-dialog cc-dialog--lg"
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cc-dialog__head">
          <div className="cc-taskhead">
            <div className="cc-taskhead__top">
              <h2 className="cc-taskhead__title">{task.title}</h2>
              <CloseButton onClose={requestClose} />
            </div>

            <div className="cc-taskhead__meta">
              <span
                className="cc-statuspill"
                style={
                  {
                    "--pill": column?.color,
                    "--pill-soft": column?.soft,
                  } as React.CSSProperties
                }
              >
                <span className="cc-statuspill__dot" />
                {column?.label ?? task.status}
              </span>

              {task.planMode && <PlanMark />}

              <span className="cc-taskhead__id">{shortId(task.id)}</span>
              <span className="cc-taskhead__sep">·</span>
              <span className="cc-taskhead__when">created {relativeTime(task.createdAt)}</span>
            </div>
          </div>
        </div>

        <div className="cc-dialog__body cc-dialog__body--wide">
          {editing ? (
            <TaskEditForm
              task={task}
              draft={draft}
              onDraftChange={setDraft}
              onAttachmentsChanged={onAttachmentsChanged}
              onSubmit={() => void save()}
            />
          ) : (
            <>
              <div className="cc-metastrip">
                {task.startedAt !== null && <Meta label="Started" value={relativeTime(task.startedAt)} />}
                {task.finishedAt !== null && <Meta label="Finished" value={relativeTime(task.finishedAt)} />}
                {task.sessionId && <Meta label="Session" value={shortId(task.sessionId)} mono />}
              </div>

              <div>
                <div className="cc-eyebrow" style={{ marginBottom: 6 }}>
                  Instructions for Claude
                </div>
                <div className="cc-promptwrap">
                  {/* The instructions are the thing people come here to change,
                      so the text itself opens the editor. The copy button sits
                      outside this element, which keeps copying from editing. */}
                  <div
                    className={[
                      task.body ? "cc-prompt" : "cc-prompt cc-prompt--empty",
                      editable ? "cc-prompt--editable" : "",
                    ].join(" ").trim()}
                    role={editable ? "button" : undefined}
                    tabIndex={editable ? 0 : undefined}
                    aria-label={editable ? "Edit the instructions for Claude" : undefined}
                    onClick={editable ? startEditing : undefined}
                    onKeyDown={
                      editable
                        ? (e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.preventDefault(); // Space would scroll the dialog
                            startEditing();
                          }
                        : undefined
                    }
                  >
                    {task.body ||
                      (editable
                        ? "No instructions yet — click to write them."
                        : "No instructions were written for this task.")}
                  </div>
                  {task.body && <CopyButton text={task.body} />}
                </div>
              </div>

              {/* Read-only here: adding and removing files is editing, and it
                  lives behind the same rule the text does. */}
              {task.attachments.length > 0 && (
                <div>
                  <div className="cc-eyebrow">Attachments ({task.attachments.length})</div>
                  <ul className="cc-filelist">
                    {task.attachments.map((file) => (
                      <li className="cc-filelist__row" key={file.id}>
                        <a
                          className="cc-filelist__name"
                          href={attachmentUrl(task.id, file.id)}
                          download={file.name}
                        >
                          {file.name}
                        </a>
                        <span className="cc-filelist__size">{fileSize(file.size)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="cc-dialog__foot">
          {editing ? (
            <>
              <button type="button" className="cc-btn cc-btn--secondary" onClick={requestExitEdit}>
                Cancel
              </button>
              <div className="cc-dialog__spacer" />
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                onClick={() => void save()}
                disabled={draft.title.trim() === ""}
              >
                Save changes
              </button>
            </>
          ) : confirmingDelete ? (
            <>
              <span style={{ font: "var(--type-body-sm)", color: "var(--ink-2)" }}>
                Delete this task for good?
              </span>
              <div className="cc-dialog__spacer" />
              <button type="button" className="cc-btn cc-btn--quiet" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--danger"
                onClick={() => void act({ type: "delete", id: task.id })}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="cc-btn cc-btn--quiet"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </button>
              <div className="cc-dialog__spacer" />
              {editable && (
                <button
                  type="button"
                  className="cc-btn cc-btn--quiet"
                  onClick={startEditing}
                  title="Change the title, instructions, files, or plan mode"
                >
                  Edit
                </button>
              )}
              {actionsFor(task).map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={`cc-btn ${action.tone}`}
                  onClick={() => void act(action.event)}
                  title={action.hint}
                >
                  {action.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
      </div>

      {/* A sibling, not a child: nested inside the overlay, a click on this
          confirmation's own backdrop would bubble out and close the dialog it
          is trying to protect. */}
      {discarding && (
        <ConfirmDialog
          title="Discard your changes?"
          detail="The edits you made to this task have not been saved."
          confirmLabel="Discard"
          onCancel={() => setDiscarding(null)}
          onConfirm={() => {
            const intent = discarding;
            setDiscarding(null);
            setEditing(false);
            if (intent === "dialog") onClose();
          }}
        />
      )}
    </>
  );
}

/** Replaced with the task's real values the moment editing starts. */
function blankDraft(): Draft {
  return { title: "", body: "", planMode: false };
}

interface Action {
  label: string;
  tone: string;
  hint: string;
  event: BoardEvent;
}

/**
 * What can be done from here.
 *
 * Notably there is no "start" action: work begins when Claude advances the
 * queue, which is what actually hands over the instructions. Offering a button
 * that moved a card into in-progress would leave a task nobody is working on.
 */
function actionsFor(task: Task): Action[] {
  const move = (to: TaskStatus): BoardEvent => ({ type: "move", id: task.id, to });

  switch (task.status) {
    case "backlog":
      return [{ label: "Queue it", tone: "cc-btn--primary", hint: "Move to the queue so Claude can pick it up", event: move("queued") }];

    case "queued":
      return [
        { label: "Back to backlog", tone: "cc-btn--secondary", hint: "Take it out of the queue", event: move("backlog") },
        { label: "Skip", tone: "cc-btn--quiet", hint: "Set aside without doing it", event: move("skipped") },
      ];

    case "in-progress":
      return [
        // Stopping is a move back to the queue: the work is abandoned, not
        // finished, and the task stays available to start again later.
        { label: "Stop work", tone: "cc-btn--secondary", hint: "Put it back in the queue — Claude is no longer working it", event: move("queued") },
        { label: "Send to review", tone: "cc-btn--primary", hint: "Mark the work done and ready for you to check", event: move("awaiting-review") },
      ];

    case "awaiting-review":
      return [
        { label: "Send back", tone: "cc-btn--secondary", hint: "Return it for another pass", event: move("in-progress") },
        { label: "Approve", tone: "cc-btn--primary", hint: "Accept the work and finish the task", event: move("done") },
      ];

    case "done":
    case "skipped":
      return [{ label: "Reopen", tone: "cc-btn--secondary", hint: "Put it back in the backlog", event: move("backlog") }];
  }
}

/**
 * One fact about the task. Only facts that exist are shown — a row of "—"
 * placeholders tells the reader nothing and crowds out what does.
 */
/** Plan mode, with a tooltip that escapes the dialog's clipped bounds. */
function PlanMark() {
  const tip = useTooltip("Plan mode — Claude plans before changing anything");

  return (
    <span className="cc-planmark" tabIndex={0} aria-label="Plan mode" {...tip.handlers}>
      <BookIcon />
      {tip.node}
    </span>
  );
}

function BookIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="cc-metastrip__item">
      <span className="cc-metastrip__label">{label}</span>
      <span className={mono ? "cc-metastrip__value cc-metastrip__value--mono" : "cc-metastrip__value"}>
        {value}
      </span>
    </span>
  );
}
