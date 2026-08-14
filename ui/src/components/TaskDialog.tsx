import { useEffect, useRef, useState } from "react";
import { attachmentUrl, removeAttachment, uploadAttachment, type BoardEvent, type Task, type TaskStatus } from "../api.ts";
import { fileSize, relativeTime, shortId } from "../lib/format.ts";
import { CopyButton } from "./CopyButton.tsx";
import { CloseButton } from "./CloseButton.tsx";
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
  onEvent: (event: BoardEvent) => void;
  /** Uploads and removals change state outside the event stream. */
  onAttachmentsChanged: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const column = COLUMNS.find((c) => c.status === task.status);
  const act = (event: BoardEvent) => {
    onEvent(event);
    onClose();
  };

  return (
    <div className="cc-overlay" onMouseDown={onClose}>
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
              <CloseButton onClose={onClose} />
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

              {task.planMode && (
                <span className="cc-planmark" aria-label="Plan mode">
                  <BookIcon />
                  <span className="cc-planmark__tip" role="tooltip">
                    Plan mode — Claude plans before changing anything
                  </span>
                </span>
              )}

              <span className="cc-taskhead__id">{shortId(task.id)}</span>
              <span className="cc-taskhead__sep">·</span>
              <span className="cc-taskhead__when">created {relativeTime(task.createdAt)}</span>
            </div>
          </div>
        </div>

        <div className="cc-dialog__body cc-dialog__body--wide">
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
              <div className={task.body ? "cc-prompt" : "cc-prompt cc-prompt--empty"}>
                {task.body || "No instructions were written for this task."}
              </div>
              {task.body && <CopyButton text={task.body} />}
            </div>
          </div>

          <div>
            <div className="cc-eyebrow">
              Attachments{task.attachments.length > 0 ? ` (${task.attachments.length})` : ""}
            </div>

            {task.attachments.length > 0 && (
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
                    <button
                      type="button"
                      className="cc-iconbtn cc-iconbtn--xs cc-iconbtn--bare"
                      aria-label={`Remove ${file.name}`}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await removeAttachment(task.id, file.id);
                        onAttachmentsChanged();
                        setBusy(false);
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              className="cc-btn cc-btn--quiet cc-btn--sm"
              style={{ marginTop: "var(--space-2)" }}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? "Uploading…" : "Add files"}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={async (e) => {
                const chosen = [...(e.target.files ?? [])];
                e.target.value = "";
                if (chosen.length === 0) return;

                setBusy(true);
                for (const file of chosen) await uploadAttachment(task.id, file);
                onAttachmentsChanged();
                setBusy(false);
              }}
            />
          </div>
        </div>

        <div className="cc-dialog__foot">
          {confirmingDelete ? (
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
                onClick={() => act({ type: "delete", id: task.id })}
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
              {actionsFor(task).map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={`cc-btn ${action.tone}`}
                  onClick={() => act(action.event)}
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
  );
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
