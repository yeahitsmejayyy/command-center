/**
 * The floating new-task button.
 *
 * On a phone the header is the furthest point from a thumb, so the primary
 * action moves to the bottom-right corner where the hand already is. It only
 * appears on narrow screens; on a desktop the header button is closer to the
 * pointer and the corner would just be a second way to do the same thing.
 */
export function NewTaskButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="cc-fab" aria-label="New task" onClick={onClick}>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}
