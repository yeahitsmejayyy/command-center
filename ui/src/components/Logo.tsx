/**
 * The command-center mark.
 *
 * Inlined rather than loaded from the two supplied SVGs, because the light and
 * dark versions differ only in the stroke colour: drawing the strokes with
 * `currentColor` lets one mark follow the theme, and there is no second file to
 * forget to swap. The orange caret stays literal — the brand notes are explicit
 * that it is never recoloured.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1.25 -1.25 50.5 50.5"
      role="img"
      aria-label="command center"
      style={{ display: "block", flex: "none" }}
    >
      <rect
        x="1"
        y="5"
        width="46"
        height="38"
        rx="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
      />
      <path
        d="M14 18.5 L20 24 L14 29.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="25.5" y="17" width="8.5" height="14" rx="2" fill="#FF6100" />
    </svg>
  );
}

/**
 * Mark plus wordmark. The wordmark is live text in Nunito Sans, which the board
 * self-hosts, matching the lockup the brand assets ship.
 */
export function Logo() {
  return (
    <span className="cc-logo">
      <LogoMark />
      <span className="cc-logo__word">command center</span>
    </span>
  );
}
