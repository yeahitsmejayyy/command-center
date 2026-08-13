import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { paths } from "./paths.ts";
import { bindLoopback, clearRuntime, publishRuntime, readRuntime } from "./runtime.ts";

const CWD = "/Users/j/dev/proj";
let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.COMMAND_CENTER_HOME;
  home = mkdtempSync(join(tmpdir(), "cc-runtime-"));
  process.env.COMMAND_CENTER_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.COMMAND_CENTER_HOME;
  else process.env.COMMAND_CENTER_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

function canConnect(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

describe("bindLoopback", () => {
  /**
   * v1 allocated a port by binding :0, reading the number, CLOSING the socket,
   * then spawning a child to re-bind it. Between the close and the re-bind the
   * port was free for anyone to take — a documented ~2s race that was retried
   * rather than fixed. Here the socket is never closed: the caller receives a
   * listener that is already accepting, so there is no window to lose.
   */
  test("returns a port that is already accepting connections", async () => {
    const listener = await bindLoopback();
    try {
      expect(await canConnect(listener.port)).toBe(true);
    } finally {
      await listener.close();
    }
  });

  test("assigns a real ephemeral port", async () => {
    const listener = await bindLoopback();
    try {
      expect(listener.port).toBeGreaterThan(0);
      expect(listener.port).toBeLessThan(65_536);
    } finally {
      await listener.close();
    }
  });

  test("hands out a different port to each concurrent listener", async () => {
    const listeners = await Promise.all([bindLoopback(), bindLoopback(), bindLoopback()]);
    try {
      expect(new Set(listeners.map((l) => l.port)).size).toBe(3);
    } finally {
      await Promise.all(listeners.map((l) => l.close()));
    }
  });

  test("binds loopback only, never a public interface", async () => {
    // Note: connecting *to* 0.0.0.0 is remapped to loopback by the OS, so it
    // proves nothing. The real check is this machine's LAN address, which must
    // refuse the connection.
    const lanAddress = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

    const listener = await bindLoopback();
    try {
      expect(listener.host).toBe("127.0.0.1");
      if (lanAddress) {
        expect(await canConnect(listener.port, lanAddress)).toBe(false);
      }
    } finally {
      await listener.close();
    }
  });

  test("the port is released once closed", async () => {
    const listener = await bindLoopback();
    const { port } = listener;
    await listener.close();

    expect(await canConnect(port)).toBe(false);
  });
});

describe("runtime records", () => {
  test("returns null when the project has no server", async () => {
    expect(await readRuntime(CWD)).toBeNull();
  });

  test("round-trips a published record", async () => {
    await publishRuntime({ cwd: CWD, pid: process.pid, port: 4321, startedAt: 111, sessionIds: ["s1"] });

    const rec = await readRuntime(CWD);
    expect(rec).toMatchObject({ cwd: CWD, pid: process.pid, port: 4321, sessionIds: ["s1"] });
  });

  test("clearRuntime removes the record", async () => {
    await publishRuntime({ cwd: CWD, pid: process.pid, port: 4321, startedAt: 111, sessionIds: [] });
    await clearRuntime(CWD);

    expect(await readRuntime(CWD)).toBeNull();
    expect(existsSync(paths.runtime(CWD))).toBe(false);
  });

  test("clearRuntime is safe when there is no record", async () => {
    await expect(clearRuntime(CWD)).resolves.toBeUndefined();
  });
});

describe("liveness and reaping", () => {
  test("a record whose process is gone reads as null", async () => {
    await publishRuntime({ cwd: CWD, pid: 999_999, port: 4321, startedAt: 111, sessionIds: [] });

    expect(await readRuntime(CWD)).toBeNull();
  });

  test("a dead record is reaped from disk, not just hidden", async () => {
    await publishRuntime({ cwd: CWD, pid: 999_999, port: 4321, startedAt: 111, sessionIds: [] });
    await readRuntime(CWD);

    expect(existsSync(paths.runtime(CWD))).toBe(false);
  });

  test("a live record survives", async () => {
    await publishRuntime({ cwd: CWD, pid: process.pid, port: 4321, startedAt: 111, sessionIds: [] });

    expect((await readRuntime(CWD))?.pid).toBe(process.pid);
    expect(existsSync(paths.runtime(CWD))).toBe(true);
  });

  test("a corrupt record is reaped rather than thrown at the caller", async () => {
    const path = paths.runtime(CWD);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ half written");

    expect(await readRuntime(CWD)).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  test("a record missing required fields is treated as corrupt", async () => {
    const path = paths.runtime(CWD);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ pid: "not a number" }));

    expect(await readRuntime(CWD)).toBeNull();
  });
});

describe("record follows the listener", () => {
  test("the published port is live at the moment it is recorded", async () => {
    const listener = await bindLoopback();
    try {
      await publishRuntime({
        cwd: CWD,
        pid: process.pid,
        port: listener.port,
        startedAt: 1,
        sessionIds: [],
      });

      const rec = await readRuntime(CWD);
      expect(rec).not.toBeNull();
      // Whatever a reader finds in the record is reachable right now.
      expect(await canConnect(rec!.port)).toBe(true);
    } finally {
      await listener.close();
    }
  });
});
