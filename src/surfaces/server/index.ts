import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { logFor, type Logger } from "../../adapters/log.ts";
import { mutate } from "../../adapters/mutate.ts";
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

export async function startServer(opts: ServeOptions): Promise<RunningServer> {
  const { cwd } = opts;
  const log = logFor(cwd);
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  const broadcast = async () => {
    if (clients.size === 0) return;
    try {
      const state = await readState(cwd);
      const frame = new TextEncoder().encode(`data: ${JSON.stringify(state)}\n\n`);
      for (const client of clients) {
        try {
          client.enqueue(frame);
        } catch {
          clients.delete(client); // client went away mid-write
        }
      }
    } catch (err) {
      await log.error("could not read state for broadcast", { error: String(err) });
    }
  };

  let watcher: Watcher | null = null;

  // port 0 lets the OS assign, and Bun reports the port off the *listening*
  // socket — the port is never unheld between assignment and use.
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch: (req) => handle(req, { cwd, log, uiDir: opts.uiDir, clients, broadcast }),
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
}

async function handle(req: Request, ctx: Context): Promise<Response> {
  const { pathname } = new URL(req.url);

  try {
    if (pathname === "/api/version") return json({ version: (await readState(ctx.cwd)).version });
    if (pathname === "/api/state") return json(await readState(ctx.cwd));
    if (pathname === "/api/stream") return stream(ctx);
    if (pathname === "/api/events" && req.method === "POST") return postEvent(req, ctx);
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

  await ctx.broadcast();
  return json({ state: result.state, effects: result.effects });
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
