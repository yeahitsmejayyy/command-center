import { useEffect, useRef, useState } from "react";
import { attachmentUrl, removeAttachment, uploadAttachment, type Task } from "../api.ts";
import { fileSize } from "../lib/format.ts";
import { Switch } from "./Switch.tsx";

export interface Draft {
  title: string;
  body: string;
  planMode: boolean;
}

/**
 * A task's details, editable.
 *
 * Only reachable while the task is in the backlog or the queue — core rejects
 * the events this fires once work has started, so the affordance and the rule
 * agree rather than the button being a lie the server has to catch.
 *
 * Text is a draft the footer commits; files are not. An upload is a real file
 * on disk the moment it is chosen, so pretending it could be rolled back by a
 * Cancel button would be the dishonest option — the remove button asks for the
 * same deliberateness it does everywhere else instead.
 */
export function TaskEditForm({
  task,
  draft,
  onDraftChange,
  onAttachmentsChanged,
  onSubmit,
}: {
  task: Task;
  draft: Draft;
  onDraftChange: (next: Draft) => void;
  onAttachmentsChanged: () => void;
  /** Enter from the title field commits, matching the new-task dialog. */
  onSubmit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => titleRef.current?.focus(), []);

  return (
    <>
      <div className="cc-field">
        <label className="cc-field__label" htmlFor="edit-task-title">
          Title
        </label>
        <input
          id="edit-task-title"
          ref={titleRef}
          className="cc-input"
          value={draft.title}
          placeholder="What needs doing?"
          onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
        />
      </div>

      <div className="cc-field">
        <label className="cc-field__label" htmlFor="edit-task-body">
          Instructions for Claude
        </label>
        <textarea
          id="edit-task-body"
          className="cc-textarea"
          value={draft.body}
          rows={6}
          placeholder="This is handed to Claude verbatim when the task starts."
          onChange={(e) => onDraftChange({ ...draft, body: e.target.value })}
        />
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

      <div className="cc-switch-row">
        <Switch
          checked={draft.planMode}
          onChange={(planMode) => onDraftChange({ ...draft, planMode })}
          label="Plan first"
          describedBy="edit-plan-first-desc"
        />
        <div className="cc-switch-row__body">
          <div className="cc-switch-row__title">Plan first</div>
          <div className="cc-switch-row__desc" id="edit-plan-first-desc">
            Claude presents a plan and waits for approval before changing anything.
          </div>
        </div>
      </div>
    </>
  );
}
