import { useEffect, useState } from "react";

/**
 * Copies a block of text in one click.
 *
 * The confirmation is the button itself changing for a moment — a toast for
 * something this small would be louder than the action.
 */
type State = "idle" | "copied" | "failed";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    // The async clipboard API is the good path, but it refuses when the
    // document is not focused or the click was not a trusted gesture. Falling
    // through to the legacy path means the button does something in every case
    // — a copy button that silently does nothing is worse than no button.
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      return;
    } catch {
      /* fall through */
    }

    setState(copyViaSelection(text) ? "copied" : "failed");
  };

  const face = {
    idle: { icon: <ClipboardIcon />, text: label, cls: "" },
    copied: { icon: <CheckIcon />, text: "Copied", cls: " cc-promptwrap__copy--done" },
    failed: { icon: <ClipboardIcon />, text: "Press ⌘C", cls: " cc-promptwrap__copy--done" },
  }[state];

  return (
    <button
      type="button"
      className={`cc-promptwrap__copy${face.cls}`}
      aria-label={state === "copied" ? "Copied" : label}
      onClick={copy}
    >
      {face.icon}
      {face.text}
    </button>
  );
}

/** Last resort: put the text in a throwaway field and let the browser copy it. */
function copyViaSelection(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);

  try {
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

function ClipboardIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="m4 12 6 6L20 6" />
    </svg>
  );
}
