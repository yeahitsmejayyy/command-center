import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { paths } from "./paths.ts";
import { clearRuntime, publishRuntime, readRuntime } from "./runtime.ts";

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
