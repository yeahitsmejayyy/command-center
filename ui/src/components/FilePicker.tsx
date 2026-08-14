import { useRef, useState } from "react";
import { fileSize } from "../lib/format.ts";

/**
 * Files staged against a task that does not exist yet.
 *
 * A new task has no id until it is created, and an attachment needs one, so the
 * dialog holds the files locally and uploads them once the task exists. Any
 * image, document, or log a person would otherwise paste into the description.
 */
export function FilePicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const add = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    // Same name and size twice in a row is a double-drop, not two files.
    const existing = new Set(files.map((f) => `${f.name}:${f.size}`));
    const added = [...incoming].filter((f) => !existing.has(`${f.name}:${f.size}`));
    onChange([...files, ...added]);
  };

  return (
    <div className="cc-field">
      <label className="cc-field__label">Attachments</label>

      <div
        className={`cc-dropzone${over ? " cc-dropzone--over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <span className="cc-dropzone__text">
          Drop screenshots, docs, or logs here — or <u>browse</u>
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            // Reset so picking the same file twice still fires a change.
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="cc-filelist">
          {files.map((file, i) => (
            <li className="cc-filelist__row" key={`${file.name}:${file.size}:${i}`}>
              <span className="cc-filelist__name">{file.name}</span>
              <span className="cc-filelist__size">{fileSize(file.size)}</span>
              <button
                type="button"
                className="cc-iconbtn cc-iconbtn--xs cc-iconbtn--bare"
                aria-label={`Remove ${file.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(files.filter((_, index) => index !== i));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
