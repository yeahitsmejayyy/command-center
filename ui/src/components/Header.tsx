import type { Connection } from "../api.ts";
import { projectName } from "../lib/format.ts";

/**
 * The header carries identity and liveness: which project this board belongs
 * to, and whether it is still hearing from the server.
 *
 * The design also shows a git branch and an attached-session id. Neither is in
 * our model, so the connection state takes that slot — it is the one piece of
 * live status the board genuinely knows.
 */
export function Header({
  cwd,
  connection,
  theme,
  onToggleTheme,
  onNewTask,
}: {
  cwd: string;
  connection: Connection;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onNewTask: () => void;
}) {
  return (
    <header className="cc-header">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span
          style={{ font: "var(--type-app-name)", letterSpacing: "var(--track-tight)", whiteSpace: "nowrap" }}
        >
          Command Center
        </span>
      </div>

      <div className="cc-header__divider" />

      <div className="cc-repochip" title={cwd}>
        <FolderIcon />
        <span className="cc-repochip__name">{projectName(cwd)}</span>
      </div>

      <ConnectionChip connection={connection} />

      <div style={{ flex: "1 1 0%" }} />

      <button
        type="button"
        className="cc-iconbtn"
        aria-label="Toggle day / night"
        title="Toggle day / night"
        onClick={onToggleTheme}
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>

      <button type="button" className="cc-btn cc-btn--primary" onClick={onNewTask}>
        New Task
      </button>
    </header>
  );
}

function ConnectionChip({ connection }: { connection: Connection }) {
  const shown = {
    live: { color: "var(--success)", label: "Live", pulse: false },
    connecting: { color: "var(--warning)", label: "Connecting…", pulse: true },
    lost: { color: "var(--danger)", label: "Server not responding", pulse: false },
  }[connection];

  return (
    <div className="cc-session" title={`Board connection: ${shown.label}`}>
      <span
        className={`cc-dot${shown.pulse ? " cc-pulse-dot" : ""}`}
        style={{ background: shown.color }}
      />
      <span className="cc-session__label">{shown.label}</span>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "0 0 auto", display: "block", color: "var(--ink-2)" }}
    >
      <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9z" />
    </svg>
  );
}

function MoonIcon() {
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
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function SunIcon() {
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
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
    </svg>
  );
}
