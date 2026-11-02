import { useEffect, useRef, useState } from "react";
import { iconImageUrl, setIcon, uploadIcon, type BoardIcon } from "../api.ts";
import { searchEmoji } from "../lib/emoji.ts";
import { LogoMark } from "./Logo.tsx";

/**
 * The project's mark, and the control that changes it.
 *
 * The mark is the control — there is no settings page to put this on, and the
 * design export already drew it this way: `.cc-mark` is a button with a nib
 * that only appears on hover, because the thing is a logo first and a control
 * second. Everything below is wiring over classes that already shipped.
 */
export function ProjectMark({ icon, size = 22 }: { icon: BoardIcon; size?: number }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture plus stop, so Escape does not also reach the board's shortcut
      // layer and close something behind this in the same press.
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="cc-mark-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="cc-mark"
        aria-label="Change this project's icon"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Change this project's icon"
        onClick={() => setOpen((was) => !was)}
      >
        <MarkFace icon={icon} size={size} />
        <span className="cc-mark__nib" aria-hidden="true">
          <PencilIcon />
        </span>
      </button>

      {open && <IconPopover icon={icon} onDone={close} />}
    </div>
  );
}

/** Whatever this project currently shows, at whatever size is asked for. */
export function MarkFace({ icon, size = 22 }: { icon: BoardIcon; size?: number }) {
  if (icon.kind === "emoji") {
    return (
      <span className="cc-mark__emoji" style={{ fontSize: size - 2 }} role="img" aria-label="Project icon">
        {icon.value}
      </span>
    );
  }

  if (icon.kind === "image") {
    return (
      <img
        className="cc-mark__img"
        src={iconImageUrl(icon)}
        width={size}
        height={size}
        alt="Project icon"
        style={{ width: size, height: size, objectFit: "cover" }}
      />
    );
  }

  return <LogoMark size={size} />;
}

const RECOMMENDED_PX = 512;

function IconPopover({ icon, onDone }: { icon: BoardIcon; onDone: () => void }) {
  const [term, setTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);

  // Opening a picker to type into it immediately is the common case.
  useEffect(() => search.current?.focus(), []);

  const groups = searchEmoji(term);

  /**
   * Nothing is applied optimistically.
   *
   * The server decides what an icon may be, and the only honest thing to show
   * while it decides is the icon that is still in force. The stream pushes the
   * new one to this tab and every other the moment it is accepted.
   */
  const run = async (action: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.message);
  };

  return (
    <div className="cc-popover" role="dialog" aria-label="Project icon">
      <div className="cc-popover__head">
        <span style={{ font: "var(--type-label)" }}>Project icon</span>
        <span className="cc-popover__hint">
          Just this project. {RECOMMENDED_PX}×{RECOMMENDED_PX} PNG, under 1 MB.
        </span>
      </div>

      <input
        ref={search}
        type="search"
        className="cc-input"
        placeholder="Search emoji"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />

      <div className="cc-emojiscroll">
        {groups.length === 0 && (
          <span className="cc-popover__hint">No emoji match “{term}”.</span>
        )}
        {groups.map((group) => (
          <div className="cc-emojigroup" key={group.name}>
            <span className="cc-popover__hint">{group.name}</span>
            <div className="cc-emojigrid">
              {group.entries.map((entry) => (
                <button
                  key={entry.char}
                  type="button"
                  className={`cc-emoji${
                    icon.kind === "emoji" && icon.value === entry.char ? " cc-emoji--on" : ""
                  }`}
                  aria-label={entry.keywords.split(" ")[0]}
                  disabled={busy}
                  onClick={() => run(() => setIcon({ kind: "emoji", value: entry.char }))}
                >
                  {entry.char}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <span className="cc-popover__hint" role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}

      <div className="cc-popover__foot">
        {/* The real input is hidden because its native rendering cannot be
            styled into this popover; the button in front of it is the control. */}
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = ""; // so re-picking the same file fires again
            if (chosen) run(() => uploadIcon(chosen));
          }}
        />
        {/* Both carry a variant: .cc-btn on its own sets no background, and a
            bare one falls through to the browser's default grey — which reads
            as a light control on Night and Neo. */}
        <button
          type="button"
          className="cc-btn cc-btn--secondary"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          Upload image
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--ghost"
          disabled={busy || icon.kind === "default"}
          onClick={() => run(() => setIcon({ kind: "default" }))}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="8"
      height="8"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
