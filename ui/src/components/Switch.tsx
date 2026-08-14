/**
 * The design system's switch. `data-state` drives the track colour and the knob
 * position, so this is markup only — no styling decisions live here.
 */
export function Switch({
  checked,
  onChange,
  label,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      className="cc-switch"
      data-state={checked ? "on" : "off"}
      onClick={() => onChange(!checked)}
    >
      <span className="cc-switch__knob" />
    </button>
  );
}
