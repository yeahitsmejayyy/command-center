import { useEffect, useRef, useState } from "react";
import { THEMES, type Theme } from "../lib/themes.ts";

/**
 * The header's colour-mode control.
 *
 * It replaces a day/night toggle. A toggle was the right shape for two modes
 * and is the wrong shape for four: there is no "next" theme, and a button
 * whose icon is the mode you are not in stops meaning anything once there are
 * three of those.
 *
 * Built as a menu rather than a <select> so each option can carry its swatch
 * and a line saying what it is — picking a colour scheme from a list of four
 * words is guesswork.
 */
export function ThemePicker({ theme, onPick }: { theme: Theme; onPick: (theme: Theme) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const current = THEMES.find((spec) => spec.id === theme) ?? THEMES[0]!;

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Stop here, or the board's own Escape handling runs too and the key
      // closes this and something behind it in the same press.
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };

    // Capture, so the key is seen before the shortcut layer gets it.
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="cc-themewrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="cc-iconbtn"
        aria-label={`Colour mode: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Colour mode: ${current.label}`}
        onClick={() => setOpen((was) => !was)}
      >
        <PaletteIcon />
      </button>

      {open && (
        <div className="cc-popover cc-popover--right" role="menu" aria-label="Colour mode">
          <div className="cc-popover__head">
            <span style={{ font: "var(--type-label)" }}>Colour mode</span>
            <span className="cc-popover__hint">Stays with this browser</span>
          </div>

          <div className="cc-themelist">
            {THEMES.map((spec) => (
              <button
                key={spec.id}
                type="button"
                role="menuitemradio"
                aria-checked={spec.id === theme}
                className={`cc-themeopt${spec.id === theme ? " cc-themeopt--on" : ""}`}
                onClick={() => {
                  onPick(spec.id);
                  setOpen(false);
                  button.current?.focus();
                }}
              >
                <span
                  className="cc-themeopt__swatch"
                  style={
                    {
                      "--sw-bg": spec.swatch[0],
                      "--sw-accent": spec.swatch[1],
                    } as React.CSSProperties
                  }
                />
                <span className="cc-themeopt__text">
                  <span className="cc-themeopt__name">{spec.label}</span>
                  <span className="cc-themeopt__hint">{spec.hint}</span>
                </span>
                {spec.id === theme && <CheckIcon />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PaletteIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2a10 10 0 1 0 0 20 2 2 0 0 0 0-4 6 6 0 0 1 0-12 2 2 0 0 0 0-4Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="cc-themeopt__check"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
