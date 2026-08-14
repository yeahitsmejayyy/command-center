/**
 * The close affordance every dialog header carries.
 *
 * Ghost styling and a fixed position on the right: it is an escape hatch, not
 * an action, so it should be findable in the same place every time without
 * competing with the buttons that actually do something.
 */
export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="cc-iconbtn cc-iconbtn--bare cc-iconbtn--sm cc-dialog__close"
      aria-label="Close"
      onClick={onClose}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}
