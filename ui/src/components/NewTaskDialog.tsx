import { useEffect, useRef, useState } from "react";
import type { TaskStatus } from "../api.ts";
import { Switch } from "./Switch.tsx";
import { FilePicker } from "./FilePicker.tsx";
import { CloseButton } from "./CloseButton.tsx";
import { useSheetGesture } from "../lib/sheetGesture.ts";
import { useIsSheet } from "../lib/useIsSheet.ts";

export function NewTaskDialog({
  status,
  columnLabel,
  onCancel,
  onCreate,
}: {
  status: TaskStatus;
  columnLabel: string;
  onCancel: () => void;
  onCreate: (task: {
    title: string;
    body: string;
    planMode: boolean;
    status: TaskStatus;
    files: File[];
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [planMode, setPlanMode] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => titleRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // The gesture is live only while the dialog is presented as a sheet.
  const isSheet = useIsSheet();
  const sheet = useSheetGesture(onCancel, isSheet);

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return; // core would reject it too; no need to round-trip
    onCreate({ title: trimmed, body: body.trim(), planMode, status, files });
  };

  return (
    // On a phone this becomes a bottom sheet — see .cc-sheet in app.css. The
    // markup is identical; only the presentation changes with the viewport.
    <div className="cc-overlay cc-overlay--sheet" onMouseDown={onCancel}>
      <div
        className="cc-dialog cc-dialog--sheet"
        style={sheet.style}
        role="dialog"
        aria-modal="true"
        aria-label={`New task in ${columnLabel}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cc-sheet__grip" {...sheet.handleProps}>
          <div className="cc-sheet__grabber" aria-hidden="true" />
        </div>

        <div className="cc-dialog__head" {...sheet.handleProps}>
          <div className="cc-dialog__title">New task in {columnLabel}</div>
          <div className="cc-dialog__spacer" />
          <CloseButton onClose={onCancel} />
        </div>

        <div className="cc-dialog__body">
          <div className="cc-field">
            <label className="cc-field__label" htmlFor="new-task-title">
              Title
            </label>
            <input
              id="new-task-title"
              ref={titleRef}
              className="cc-input"
              value={title}
              placeholder="What needs doing?"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits from the title; the body needs real newlines.
                if (e.key === "Enter") submit();
              }}
            />
          </div>

          <div className="cc-field">
            <label className="cc-field__label" htmlFor="new-task-body">
              Instructions for Claude
            </label>
            <textarea
              id="new-task-body"
              className="cc-textarea"
              value={body}
              rows={6}
              placeholder="This is handed to Claude verbatim when the task starts."
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <FilePicker files={files} onChange={setFiles} />

          {/* Switch leads, copy follows — the control is the thing being set. */}
          <div className="cc-switch-row">
            <Switch
              checked={planMode}
              onChange={setPlanMode}
              label="Plan first"
              describedBy="plan-first-desc"
            />
            <div className="cc-switch-row__body">
              <div className="cc-switch-row__title">Plan first</div>
              <div className="cc-switch-row__desc" id="plan-first-desc">
                Claude presents a plan and waits for approval before changing anything.
              </div>
            </div>
          </div>
        </div>

        <div className="cc-dialog__foot">
          <button type="button" className="cc-btn cc-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <div className="cc-dialog__spacer" />
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            onClick={submit}
            disabled={title.trim() === ""}
          >
            Add task
          </button>
        </div>
      </div>
    </div>
  );
}
