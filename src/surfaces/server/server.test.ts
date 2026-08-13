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
