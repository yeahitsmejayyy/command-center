import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { logFor, type Logger } from "../../adapters/log.ts";
import {
  deleteAttachment,
  deleteTaskAttachments,
  readAttachment,
  writeAttachment,
} from "../../adapters/attachments.ts";
import {
  MAX_ICON_BYTES,
  RECOMMENDED_ICON_PX,
  deleteIcon,
  readIcon,
  sniffImageType,
  writeIcon,
} from "../../adapters/icon.ts";
import { mutate } from "../../adapters/mutate.ts";
import { MAX_EMOJI_LENGTH, readPrefs, setIcon, type BoardIcon } from "../../adapters/prefs.ts";
import { clearRuntime, publishRuntime } from "../../adapters/runtime.ts";
import { readState } from "../../adapters/store.ts";
import type { Event, ProjectState } from "../../core/types.ts";
import { watchState, type Watcher } from "./watch.ts";

/**
 * HTTP surface over the same core the CLI uses.
 *
 * Every mutation goes through adapters/mutate, so there is exactly one
 * definition of what an event does — this file translates HTTP to an event and
 * back, and owns nothing else.
 */

export interface ServeOptions {
  cwd: string;
  /** Directory of prebuilt UI assets. Absent during M5; wired up in M8. */
  uiDir?: string;
}

export interface RunningServer {
  readonly port: number;
  readonly url: string;
  stop(): Promise<void>;
}

/**
 * The prebuilt board, shipped with the plugin.
 *
 * Claude Code installs plugins with `--ignore-scripts`, so Vite never runs on a
 * user's machine — `ui/dist` is committed and served as-is. Absent (a checkout
 * that has not been built), the server still serves its API and says so.
 */
function bundledUi(): string | undefined {
  const dir = join(import.meta.dir, "..", "..", "..", "ui", "dist");
  return existsSync(join(dir, "index.html")) ? dir : undefined;
}

export async function startServer(opts: ServeOptions): Promise<RunningServer> {
  const { cwd } = opts;
  const uiDir = opts.uiDir ?? bundledUi();
  const log = logFor(cwd);
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  /** Pushes one already-encoded SSE frame to everyone still listening. */
  const push = (frame: string) => {
    if (clients.size === 0) return;
    const bytes = new TextEncoder().encode(frame);
    for (const client of clients) {
      try {
        client.enqueue(bytes);
      } catch {
        clients.delete(client); // client went away mid-write
      }
    }
  };

  const broadcast = async () => {
    if (clients.size === 0) return;
    try {
      push(`data: ${JSON.stringify(await readState(cwd))}\n\n`);
    } catch (err) {
      await log.error("could not read state for broadcast", { error: String(err) });
    }
  };

  /**
   * The icon travels as a named event, so the default `message` frames stay
   * exactly what they were: a board state and nothing else. A client that has
   * never heard of icons ignores this one.
   */
  const broadcastIcon = async () => {
    if (clients.size === 0) return;
    try {
      push(`event: icon\ndata: ${JSON.stringify({ icon: (await readPrefs(cwd)).icon })}\n\n`);
    } catch (err) {
      await log.error("could not read prefs for broadcast", { error: String(err) });
    }
  };

  let watcher: Watcher | null = null;

  // port 0 lets the OS assign, and Bun reports the port off the *listening*
  // socket — the port is never unheld between assignment and use.
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch: (req) => handle(req, { cwd, log, uiDir, clients, broadcast, broadcastIcon }),
  });

  // Bun types this optional, but a listening server always has one.
  const port = server.port;
  if (port === undefined) {
    server.stop(true);
    throw new Error("The server started but the OS reported no bound port.");
  }

  watcher = watchState(cwd, () => void broadcast());

  await publishRuntime({
    cwd,
    pid: process.pid,
    port,
    startedAt: Date.now(),
    sessionIds: [],
  });

  await log.info("server started", { port, pid: process.pid });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    watcher?.stop();
    for (const client of clients) {
      try {
        client.close();
      } catch {
        /* already gone */
      }
    }
    clients.clear();
    server.stop(true);
    await clearRuntime(cwd);
    await log.info("server stopped");
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stop().then(() => process.exit(0));
    });
  }

  return { port, url: `http://127.0.0.1:${port}`, stop };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

interface Context {
  cwd: string;
  log: Logger;
  uiDir?: string;
  clients: Set<ReadableStreamDefaultController<Uint8Array>>;
  broadcast: () => Promise<void>;
  broadcastIcon: () => Promise<void>;
}

async function handle(req: Request, ctx: Context): Promise<Response> {
  const { pathname } = new URL(req.url);

  try {
    if (pathname === "/api/version") return json({ version: (await readState(ctx.cwd)).version });
    if (pathname === "/api/state") return json(await readState(ctx.cwd));
    if (pathname === "/api/stream") return stream(ctx);
    if (pathname === "/api/events" && req.method === "POST") return postEvent(req, ctx);

    if (pathname === "/api/icon") return handleIcon(req, ctx);
    if (pathname === "/api/icon/image") return handleIconImage(req, ctx);

    const attachment = pathname.match(/^\/api\/tasks\/([^/]+)\/attachments(?:\/([^/]+))?$/);
    if (attachment) return handleAttachment(req, ctx, attachment[1]!, attachment[2]);

    if (pathname.startsWith("/api/")) return fail(404, "NOT_FOUND", `No route for ${pathname}.`, ctx);

    return serveUi(pathname, ctx);
  } catch (err) {
    await ctx.log.error("request failed", { pathname, error: String(err) });
    return fail(500, "INTERNAL", "Something went wrong handling that request.", ctx);
  }
}

async function postEvent(req: Request, ctx: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "BAD_JSON", "The request body was not valid JSON.", ctx);
  }

  if (typeof body !== "object" || body === null) {
    return fail(400, "BAD_EVENT", "The request body must be an event object.", ctx);
  }

  // The clock belongs to the server: a client must not be able to backdate an
  // event, and core is pure so the timestamp has to come from a surface.
  const event = { ...(body as Record<string, unknown>), at: Date.now() } as Event;

  const result = await mutate(ctx.cwd, event);
  if (!result.ok) {
    await ctx.log.warn("event rejected", { code: result.error.code, message: result.error.message });
    return json({ error: result.error, logPath: ctx.log.path }, 409);
  }

  // A deleted task's files have nothing left to belong to. Core does not know
  // about the filesystem, so the surface that owns the bytes cleans them up.
  if (event.type === "delete" && typeof event.id === "string") {
    await deleteTaskAttachments(ctx.cwd, event.id);
  }

  await ctx.broadcast();
  return json({ state: result.state, effects: result.effects });
}

/**
 * The project's board icon: read it, set it, clear it.
 *
 * The choice is a preference rather than board state, so it travels on its own
 * route and its own SSE event. Folding it into the state payload would have
 * meant every mutation response carrying it too — and the board replaces its
 * state wholesale from those responses, so the one that forgot would blank the
 * icon until the next reload.
 */
async function handleIcon(req: Request, ctx: Context): Promise<Response> {
  if (req.method === "GET") {
    return json({ icon: (await readPrefs(ctx.cwd)).icon, recommendedPx: RECOMMENDED_ICON_PX });
  }

  if (req.method === "PUT") {
    const body = (await req.json().catch(() => null)) as { kind?: string; value?: string } | null;

    if (body?.kind === "default") return resetIcon(ctx);

    if (body?.kind === "emoji") {
      const value = (body.value ?? "").trim();
      if (!value) {
        return fail(400, "NO_EMOJI", "That did not include an emoji.", ctx);
      }
      if (value.length > MAX_EMOJI_LENGTH) {
        return fail(400, "NOT_AN_EMOJI", "Pick a single emoji — that is too long to be one.", ctx);
      }
      // A codepoint typed into a field is not what was asked for, and an
      // arbitrary string drawn at 19px is a wordmark nobody chose.
      if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value)) {
        return fail(400, "NOT_AN_EMOJI", "That is not an emoji. Pick one from the list.", ctx);
      }

      await deleteIcon(ctx.cwd); // the old upload is no longer anyone's icon
      await setIcon(ctx.cwd, { kind: "emoji", value });
      await ctx.broadcastIcon();
      return json({ icon: { kind: "emoji", value } satisfies BoardIcon });
    }

    return fail(400, "BAD_ICON", 'Send {"kind":"default"} or {"kind":"emoji","value":"🛰"}.', ctx);
  }

  if (req.method === "DELETE") return resetIcon(ctx);

  return fail(405, "BAD_METHOD", `${req.method} is not supported here.`, ctx);
}

async function resetIcon(ctx: Context): Promise<Response> {
  await deleteIcon(ctx.cwd);
  await setIcon(ctx.cwd, { kind: "default" });
  await ctx.broadcastIcon();
  return json({ icon: { kind: "default" } satisfies BoardIcon });
}

/**
 * Upload an icon, or serve the uploaded one.
 *
 * Unlike an attachment, this is served inline — a picture has to render to be
 * an icon. That is a privilege attachments are deliberately denied, so it is
 * earned here instead: the bytes are identified by their own leading bytes,
 * never by the Content-Type the uploader claimed, and only four inert raster
 * formats are allowed through. SVG is refused precisely because it would
 * render: it is a document that can carry script, and this one is served from
 * the board's own origin.
 */
async function handleIconImage(req: Request, ctx: Context): Promise<Response> {
  if (req.method === "GET") {
    const prefs = await readPrefs(ctx.cwd);
    if (prefs.icon.kind !== "image") {
      return fail(404, "NO_ICON", "This project has not uploaded an icon.", ctx);
    }
    const bytes = await readIcon(ctx.cwd);
    if (!bytes) return fail(404, "NOT_FOUND", "That icon is no longer on disk.", ctx);

    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": prefs.icon.mediaType,
        // Sniffed on upload and pinned here: the browser must not be allowed to
        // reconsider the type of a file a user supplied.
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        // The URL is stable across uploads, so freshness comes from the
        // ?v=updatedAt the board appends, not from revalidation.
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  if (req.method === "POST") {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return fail(400, "NO_FILE", "That upload did not include a file.", ctx);
    }
    if (file.size > MAX_ICON_BYTES) {
      return fail(
        413,
        "TOO_LARGE",
        `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 1 MB — ` +
          `a ${RECOMMENDED_ICON_PX}x${RECOMMENDED_ICON_PX} PNG is usually well under it.`,
        ctx,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mediaType = sniffImageType(bytes);
    if (!mediaType) {
      return fail(
        415,
        "NOT_AN_IMAGE",
        "That file is not a PNG, JPEG, GIF, or WebP. SVG is not accepted — " +
          `export a ${RECOMMENDED_ICON_PX}x${RECOMMENDED_ICON_PX} PNG instead.`,
        ctx,
      );
    }

    const updatedAt = Date.now();
    await writeIcon(ctx.cwd, bytes);
    await setIcon(ctx.cwd, { kind: "image", mediaType, updatedAt });
    await ctx.broadcastIcon();
    return json({ icon: { kind: "image", mediaType, updatedAt } satisfies BoardIcon });
  }

  return fail(405, "BAD_METHOD", `${req.method} is not supported here.`, ctx);
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Upload, download, and remove a task's files.
 *
 * The id is generated here, never taken from the uploaded filename — the name
 * is metadata shown to the user, and letting it reach the filesystem is how a
 * file called "../../.ssh/authorized_keys" gets written.
 */
async function handleAttachment(
  req: Request,
  ctx: Context,
  taskId: string,
  attachmentId?: string,
): Promise<Response> {
  if (req.method === "POST" && !attachmentId) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return fail(400, "NO_FILE", "That upload did not include a file.", ctx);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return fail(
        413,
        "TOO_LARGE",
        `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.`,
        ctx,
      );
    }

    const id = `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await writeAttachment(ctx.cwd, taskId, id, await file.arrayBuffer());

    const result = await mutate(ctx.cwd, {
      type: "attach",
      at: Date.now(),
      id: taskId,
      attachment: {
        id,
        name: file.name || "untitled",
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        addedAt: Date.now(),
      },
    });

    if (!result.ok) {
      await deleteAttachment(ctx.cwd, taskId, id); // do not leave an orphan on disk
      return json({ error: result.error, logPath: ctx.log.path }, 409);
    }

    await ctx.broadcast();
    return json({ state: result.state });
  }

  if (req.method === "GET" && attachmentId) {
    const bytes = await readAttachment(ctx.cwd, taskId, attachmentId);
    if (!bytes) return fail(404, "NOT_FOUND", "That file is no longer on disk.", ctx);

    const state = await readState(ctx.cwd);
    const meta = state.tasks
      .find((t) => t.id === taskId)
      ?.attachments.find((a) => a.id === attachmentId);

    // Always an attachment, never inline: these are files a user dropped in,
    // and rendering one as HTML in the board's own origin would let it act as
    // the board. Downloading is the only thing a file needs to do here.
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": meta?.mimeType ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${(meta?.name ?? attachmentId).replace(/"/g, "")}"`,
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (req.method === "DELETE" && attachmentId) {
    const result = await mutate(ctx.cwd, {
      type: "detach",
      at: Date.now(),
      id: taskId,
      attachmentId,
    });
    if (!result.ok) return json({ error: result.error, logPath: ctx.log.path }, 409);

    await deleteAttachment(ctx.cwd, taskId, attachmentId);
    await ctx.broadcast();
    return json({ state: result.state });
  }

  return fail(405, "BAD_METHOD", `${req.method} is not supported here.`, ctx);
}

function stream(ctx: Context): Response {
  const encoder = new TextEncoder();

  // Captured so cancel() can deregister: the cancel callback receives the
  // reason, not the controller.
  let registered: ReadableStreamDefaultController<Uint8Array> | null = null;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      registered = controller;
      ctx.clients.add(controller);
      try {
        const state = await readState(ctx.cwd);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
      } catch {
        /* the first push will carry it instead */
      }
    },
    cancel() {
      if (registered) ctx.clients.delete(registered);
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function serveUi(pathname: string, ctx: Context): Response {
  if (!ctx.uiDir) {
    return new Response(
      "command-center is running. The board UI ships in a later milestone.\n",
      { headers: { "content-type": "text/plain" } },
    );
  }

  // Contain path traversal: everything must resolve inside uiDir.
  const relative = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const candidate = join(ctx.uiDir, relative);
  if (!candidate.startsWith(ctx.uiDir)) return new Response("Not found", { status: 404 });

  const file = existsSync(candidate) ? candidate : join(ctx.uiDir, "index.html");
  return new Response(Bun.file(file));
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fail(status: number, code: string, message: string, ctx: Context): Response {
  return json({ error: { code, message }, logPath: ctx.log.path }, status);
}

export type { ProjectState };
