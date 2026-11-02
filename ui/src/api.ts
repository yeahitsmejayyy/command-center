/**
 * The board's view of the server.
 *
 * The wire types mirror `src/core/types.ts`. They are restated here rather than
 * imported because the UI is a separate build with its own dependency graph,
 * and reaching across would drag the core's validation library into the bundle
 * for types that are erased at compile time anyway.
 */

export type TaskStatus =
  | "backlog"
  | "queued"
  | "in-progress"
  | "awaiting-review"
  | "done"
  | "skipped";

/**
 * Where a task's details are still the user's to change. Mirrors
 * EDITABLE_STATUSES in src/core/types.ts — core is what enforces it; this only
 * decides whether the board offers the control.
 */
export const EDITABLE_STATUSES: readonly TaskStatus[] = ["backlog", "queued"];

export function isEditable(task: Task): boolean {
  return EDITABLE_STATUSES.includes(task.status);
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  addedAt: number;
}

export interface Task {
  id: string;
  title: string;
  body: string;
  status: TaskStatus;
  order: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  attempts: number;
  planMode: boolean;
  sessionId: string | null;
  /** A label the dispatcher chose for whoever is working it, not an identity. */
  agent: string | null;
  attachments: Attachment[];
}

export interface ProjectState {
  version: number;
  cwd: string;
  updatedAt: number;
  tasks: Task[];
}

/** What the board can ask the server to do. The server stamps the timestamp. */
export type BoardEvent =
  | { type: "create"; id: string; title: string; body?: string; planMode?: boolean; status?: TaskStatus }
  | { type: "update"; id: string; title?: string; body?: string; planMode?: boolean }
  | { type: "delete"; id: string }
  | { type: "move"; id: string; to: TaskStatus; order?: number }
  | { type: "reorder"; id: string; order: number };

export type Connection = "connecting" | "live" | "lost";

/**
 * What the board draws in place of the command-center mark. Mirrors BoardIcon
 * in src/adapters/prefs.ts.
 *
 * It is a preference, not board state, so it arrives on its own route and its
 * own stream event — the state payload stays a list of tasks.
 */
export type BoardIcon =
  | { kind: "default" }
  | { kind: "emoji"; value: string }
  | { kind: "image"; mediaType: string; updatedAt: number };

/**
 * Where the uploaded icon lives.
 *
 * The path never changes, so the server caches it hard and freshness comes from
 * this query — without it, replacing an icon would leave the old one on screen
 * until a hard reload.
 */
export function iconImageUrl(icon: Extract<BoardIcon, { kind: "image" }>): string {
  return `/api/icon/image?v=${icon.updatedAt}`;
}

export interface RejectedEvent {
  code: string;
  message: string;
  taskId?: string;
}

export async function fetchState(): Promise<ProjectState> {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error(`The board could not be loaded (HTTP ${res.status}).`);
  return (await res.json()) as ProjectState;
}

/**
 * Sends an event and returns the resulting state.
 *
 * A rejection is a value, not an exception: core answers 409 with a message
 * written for a human, and the board shows that message rather than inventing
 * its own wording for a rule it does not own.
 */
export async function sendEvent(
  event: BoardEvent,
): Promise<{ ok: true; state: ProjectState } | { ok: false; error: RejectedEvent }> {
  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });

  if (res.status === 409) {
    const body = (await res.json()) as { error: RejectedEvent };
    return { ok: false, error: body.error };
  }
  if (!res.ok) {
    return { ok: false, error: { code: "REQUEST_FAILED", message: `The server refused that change (HTTP ${res.status}).` } };
  }

  const body = (await res.json()) as { state: ProjectState };
  return { ok: true, state: body.state };
}

/**
 * Subscribes to board changes.
 *
 * The server pushes on any change — including ones made by Claude in a separate
 * process — so this is the only thing keeping the board current. EventSource
 * reconnects on its own, which is why a dropped server heals without any retry
 * logic here; the connection callback exists so the UI can say so meanwhile.
 */
export function subscribe(
  onState: (state: ProjectState) => void,
  onConnection: (status: Connection) => void,
  /** Fires when another tab, or the CLI, changes the project's icon. */
  onIcon: (icon: BoardIcon) => void = () => {},
  /** How long a reconnect may run before the board admits it is stale. */
  giveUpAfterMs = 4_000,
): () => void {
  let source: EventSource | null = null;
  let closed = false;
  let givingUp: ReturnType<typeof setTimeout> | null = null;
  let status: Connection = "connecting";

  const settle = (next: Connection) => {
    if (givingUp) {
      clearTimeout(givingUp);
      givingUp = null;
    }
    status = next;
    onConnection(next);
  };

  const open = () => {
    if (closed) return;
    settle("connecting");
    source = new EventSource("/api/stream");

    source.onopen = () => settle("live");

    source.onmessage = (message) => {
      try {
        onState(JSON.parse(message.data) as ProjectState);
        settle("live");
      } catch {
        // A malformed frame is not worth tearing the connection down for.
      }
    };

    // A named event, so it never reaches onmessage above and can never be
    // mistaken for a board state.
    source.addEventListener("icon", (event) => {
      try {
        onIcon((JSON.parse((event as MessageEvent).data) as { icon: BoardIcon }).icon);
      } catch {
        // As above: ignore a frame we cannot read.
      }
    });

    source.onerror = () => {
      if (closed) return;

      // EventSource reconnects on its own and never reports CLOSED while it is
      // still trying, so waiting for that state means a dead server shows as
      // "connecting" forever — the board looks fine while quietly going stale.
      // A brief grace period covers a server restart; past that, say so.
      //
      // Once given up, stay given up: every retry fires another error, and
      // treating each one as a fresh attempt makes the banner flicker in and
      // out. Only a connection that actually opens clears it.
      if (status === "lost" || givingUp !== null) return;

      status = "connecting";
      onConnection("connecting");
      givingUp = setTimeout(() => {
        givingUp = null;
        status = "lost";
        onConnection("lost");
      }, giveUpAfterMs);
    };
  };

  open();

  return () => {
    closed = true;
    if (givingUp) clearTimeout(givingUp);
    source?.close();
  };
}

/**
 * Uploads one file against a task.
 *
 * Multipart rather than JSON: these are real files, and base64 in a JSON body
 * would inflate them by a third for no benefit.
 */
export async function uploadAttachment(
  taskId: string,
  file: File,
): Promise<{ ok: true; state: ProjectState } | { ok: false; error: RejectedEvent }> {
  const body = new FormData();
  body.append("file", file);

  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments`, {
    method: "POST",
    body,
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: RejectedEvent } | null;
    return {
      ok: false,
      error: payload?.error ?? {
        code: "UPLOAD_FAILED",
        message: `"${file.name}" could not be attached (HTTP ${res.status}).`,
      },
    };
  }

  return { ok: true, state: ((await res.json()) as { state: ProjectState }).state };
}

export async function removeAttachment(taskId: string, attachmentId: string): Promise<void> {
  await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE" },
  );
}

export function attachmentUrl(taskId: string, attachmentId: string): string {
  return `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

/** Ids are generated by whichever surface creates the task; core only requires uniqueness. */
export function newTaskId(): string {
  return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}


/** The project's current icon, read once at load. The stream keeps it current. */
export async function fetchIcon(): Promise<BoardIcon> {
  const res = await fetch("/api/icon");
  if (!res.ok) throw new Error(`The project icon could not be read (HTTP ${res.status}).`);
  return ((await res.json()) as { icon: BoardIcon }).icon;
}

/**
 * Sets the icon to an emoji, or back to the default.
 *
 * The server owns what counts as an emoji and says so in its own words, which
 * is why a refusal comes back as a message rather than a thrown error — the
 * board shows what it was told, as it does for a rejected event.
 */
export async function setIcon(
  choice: { kind: "default" } | { kind: "emoji"; value: string },
): Promise<{ ok: true; icon: BoardIcon } | { ok: false; message: string }> {
  const res = await fetch("/api/icon", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(choice),
  });
  return readIconResponse(res);
}

export async function uploadIcon(
  file: File,
): Promise<{ ok: true; icon: BoardIcon } | { ok: false; message: string }> {
  const body = new FormData();
  body.append("file", file);
  return readIconResponse(await fetch("/api/icon/image", { method: "POST", body }));
}

async function readIconResponse(
  res: Response,
): Promise<{ ok: true; icon: BoardIcon } | { ok: false; message: string }> {
  if (res.ok) return { ok: true, icon: ((await res.json()) as { icon: BoardIcon }).icon };

  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return {
    ok: false,
    message: body?.error?.message ?? `That icon was refused (HTTP ${res.status}).`,
  };
}
