import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../../adapters/paths.ts";
import { readRuntime } from "../../adapters/runtime.ts";
import { readState } from "../../adapters/store.ts";
import { startServer, type RunningServer } from "./index.ts";

const CLI = join(import.meta.dir, "..", "cli", "main.ts");
let home: string;
let project: string;
let server: RunningServer | null = null;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cc-srv-home-"));
  project = mkdtempSync(join(tmpdir(), "cc-srv-proj-"));
  process.env.COMMAND_CENTER_HOME = home;
});

afterEach(async () => {
  await server?.stop();
  server = null;
  delete process.env.COMMAND_CENTER_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

async function start() {
  server = await startServer({ cwd: project });
  return server;
}

function url(s: RunningServer, path: string) {
  return `http://127.0.0.1:${s.port}${path}`;
}

/** Runs the CLI in a separate process — the whole point is that it isn't us. */
async function cli(...args: string[]) {
  const proc = Bun.spawn(["bun", "run", CLI, "--cwd", project, ...args], {
    env: { ...process.env, COMMAND_CENTER_HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  return new Response(proc.stdout).text();
}

describe("binding", () => {
  test("starts on an OS-assigned port and answers immediately", async () => {
    const s = await start();

    expect(s.port).toBeGreaterThan(0);
    expect((await fetch(url(s, "/api/version"))).status).toBe(200);
  });

  test("binds loopback only, never a public interface", async () => {
    const s = await start();
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

    if (!lan) return; // no external interface on this machine
    await expect(
      fetch(`http://${lan}:${s.port}/api/version`, { signal: AbortSignal.timeout(500) }),
    ).rejects.toThrow();
  });

  test("two projects can serve at once on different ports", async () => {
    const a = await start();
    const other = mkdtempSync(join(tmpdir(), "cc-srv-proj2-"));
    const b = await startServer({ cwd: other });
    try {
      expect(a.port).not.toBe(b.port);
    } finally {
      await b.stop();
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("runtime record", () => {
  test("publishes a record whose port is live", async () => {
    const s = await start();
    const record = await readRuntime(project);

    expect(record?.port).toBe(s.port);
    expect((await fetch(url(s, "/api/version"))).status).toBe(200);
  });

  test("clears the record on graceful shutdown", async () => {
    const s = await start();
    await s.stop();
    server = null;

    expect(await readRuntime(project)).toBeNull();
    expect(existsSync(paths.runtime(project))).toBe(false);
  });

  test("leaves no lock behind after shutdown", async () => {
    const s = await start();
    await fetch(url(s, "/api/events"), {
      method: "POST",
      body: JSON.stringify({ type: "create", id: "t1", title: "Task" }),
    });
    await s.stop();
    server = null;

    expect(existsSync(paths.lock(project))).toBe(false);
  });
});

describe("reads", () => {
  test("GET /api/state returns the board", async () => {
    await cli("add", "From the CLI");
    const s = await start();

    const state = (await (await fetch(url(s, "/api/state"))).json()) as any;
    expect(state.tasks[0].title).toBe("From the CLI");
  });

  test("GET /api/version is a cheap version probe", async () => {
    const s = await start();

    const body = (await (await fetch(url(s, "/api/version"))).json()) as any;
    expect(body).toEqual({ version: 0 });
  });

  test("GET /api/version reflects changes made by another process", async () => {
    const s = await start();
    await cli("add", "Task");

    const body = (await (await fetch(url(s, "/api/version"))).json()) as any;
    expect(body.version).toBe(1);
  });

  test("an unknown API route 404s", async () => {
    const s = await start();

    expect((await fetch(url(s, "/api/nope"))).status).toBe(404);
  });
});

describe("writes", () => {
  test("POST /api/events applies and persists an event", async () => {
    const s = await start();

    const res = await fetch(url(s, "/api/events"), {
      method: "POST",
      body: JSON.stringify({ type: "create", id: "t1", title: "Via HTTP" }),
    });

    expect(res.status).toBe(200);
    expect((await readState(project)).tasks[0]!.title).toBe("Via HTTP");
  });

  test("the response carries the new state so the UI need not refetch", async () => {
    const s = await start();

    const body = (await (await fetch(url(s, "/api/events"), {
      method: "POST",
      body: JSON.stringify({ type: "create", id: "t1", title: "Via HTTP" }),
    })).json()) as any;

    expect(body.state.tasks).toHaveLength(1);
    expect(body.state.version).toBe(1);
  });

  test("a rejected event returns 409 and explains why", async () => {
    const s = await start();

    const res = await fetch(url(s, "/api/events"), {
      method: "POST",
      body: JSON.stringify({ type: "finish" }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("E_NO_ACTIVE_TASK");
    expect(body.error.message.toLowerCase()).toContain("nothing to finish");
  });

  test("a malformed body returns 400 rather than crashing the server", async () => {
    const s = await start();

    const res = await fetch(url(s, "/api/events"), { method: "POST", body: "{ not json" });
    expect(res.status).toBe(400);

    // Still serving afterwards.
    expect((await fetch(url(s, "/api/version"))).status).toBe(200);
  });

  test("the server supplies the timestamp, so clients cannot forge one", async () => {
    const s = await start();

    await fetch(url(s, "/api/events"), {
      method: "POST",
      body: JSON.stringify({ type: "create", id: "t1", title: "Task", at: 5 }),
    });

    expect((await readState(project)).tasks[0]!.createdAt).toBeGreaterThan(5);
  });
});

describe("live updates", () => {
  /**
   * The decisive case. Claude runs `cmc finish` in its own process, writing the
   * state file directly — the server never sees that HTTP request. If the board
   * only pushed changes it made itself, it would silently go stale exactly when
   * it matters most.
   */
  test("pushes a change made by a different process", async () => {
    const s = await start();

    const res = await fetch(url(s, "/api/stream"));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    await cli("add", "Added by the CLI");

    let received = "";
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !received.includes("Added by the CLI")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }
    await reader.cancel();

    expect(received).toContain("Added by the CLI");
  });

  test("sends the current state immediately on connect", async () => {
    await cli("add", "Already here");
    const s = await start();

    const res = await fetch(url(s, "/api/stream"));
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();

    expect(new TextDecoder().decode(value)).toContain("Already here");
  });

  test("the stream is served as event-stream", async () => {
    const s = await start();

    const res = await fetch(url(s, "/api/stream"));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.body!.cancel();
  });
});

describe("logging", () => {
  test("records startup in the per-project log", async () => {
    const s = await start();

    const log = readFileSync(paths.log(project), "utf8");
    expect(log).toContain("server started");
    expect(log).toContain(String(s.port));
  });

  test("an error response tells the user where the log is", async () => {
    const s = await start();

    const body = (await (await fetch(url(s, "/api/events"), { method: "POST", body: "{ bad" })).json()) as any;
    expect(body.logPath).toBe(paths.log(project));
  });
});

/**
 * The board icon.
 *
 * The interesting cases are all refusals: an icon is the one uploaded file the
 * board serves inline from its own origin, so what it declines to store matters
 * more than what it stores.
 */
describe("board icon", () => {
  /** A one-pixel PNG, as real bytes — sniffing is the thing under test. */
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  async function upload(s: RunningServer, bytes: Uint8Array, name: string, type: string) {
    const form = new FormData();
    form.set("file", new File([bytes], name, { type }));
    return fetch(url(s, "/api/icon/image"), { method: "POST", body: form });
  }

  test("a project that never picked one is on the default", async () => {
    const s = await start();
    const body = (await (await fetch(url(s, "/api/icon"))).json()) as any;
    expect(body.icon).toEqual({ kind: "default" });
  });

  test("an emoji survives a restart", async () => {
    const first = await start();
    const res = await fetch(url(first, "/api/icon"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "emoji", value: "🛰️" }),
    });
    expect(res.status).toBe(200);
    await first.stop();

    server = await startServer({ cwd: project });
    const body = (await (await fetch(url(server, "/api/icon"))).json()) as any;
    expect(body.icon).toEqual({ kind: "emoji", value: "🛰️" });
  });

  test("a string that is not an emoji is refused", async () => {
    const s = await start();
    const res = await fetch(url(s, "/api/icon"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "emoji", value: "hello" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.message).toMatch(/not an emoji/i);
  });

  test("an uploaded PNG is stored and served back inline", async () => {
    const s = await start();
    expect((await upload(s, PNG, "mark.png", "image/png")).status).toBe(200);

    const img = await fetch(url(s, "/api/icon/image"));
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
  });

  test("an SVG is refused however it labels itself", async () => {
    const s = await start();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const res = await upload(s, svg, "mark.svg", "image/png");

    expect(res.status).toBe(415);
    expect(((await res.json()) as any).error.message).toMatch(/not a PNG/i);
    // And nothing was written: a refused upload leaves the project on default.
    expect(((await (await fetch(url(s, "/api/icon"))).json()) as any).icon).toEqual({ kind: "default" });
  });

  test("a file over the limit is refused with the size in the message", async () => {
    const s = await start();
    const big = new Uint8Array(2 * 1024 * 1024);
    big.set(PNG);
    const res = await upload(s, big, "huge.png", "image/png");

    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error.message).toMatch(/2\.0 MB.*limit is 1 MB/i);
  });

  test("resetting clears both the choice and the bytes", async () => {
    const s = await start();
    await upload(s, PNG, "mark.png", "image/png");
    expect(existsSync(paths.icon(project))).toBe(true);

    const res = await fetch(url(s, "/api/icon"), { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).icon).toEqual({ kind: "default" });
    expect(existsSync(paths.icon(project))).toBe(false);
    expect((await fetch(url(s, "/api/icon/image"))).status).toBe(404);
  });

  test("picking an emoji drops the image that is no longer the icon", async () => {
    const s = await start();
    await upload(s, PNG, "mark.png", "image/png");

    await fetch(url(s, "/api/icon"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "emoji", value: "🚀" }),
    });

    expect(existsSync(paths.icon(project))).toBe(false);
  });

  test("the choice does not disturb the other preferences", async () => {
    const s = await start();
    await cli("concurrency", "3");
    await fetch(url(s, "/api/icon"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "emoji", value: "🚀" }),
    });

    const prefs = JSON.parse(readFileSync(paths.prefs(project), "utf8"));
    expect(prefs.concurrency).toBe(3);
    expect(prefs.icon).toEqual({ kind: "emoji", value: "🚀" });
  });
});
