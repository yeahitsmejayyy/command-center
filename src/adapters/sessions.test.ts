import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachSession, detachSession, publishRuntime, readRuntime } from "./runtime.ts";

const CWD = "/Users/j/dev/proj";
let home: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.COMMAND_CENTER_HOME;
  home = mkdtempSync(join(tmpdir(), "cc-sessions-"));
  process.env.COMMAND_CENTER_HOME = home;
  await publishRuntime({ cwd: CWD, pid: process.pid, port: 4321, startedAt: 1, sessionIds: [] });
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.COMMAND_CENTER_HOME;
  else process.env.COMMAND_CENTER_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

describe("attachSession", () => {
  test("records a session against the running server", async () => {
    await attachSession(CWD, "s1");

    expect((await readRuntime(CWD))?.sessionIds).toEqual(["s1"]);
  });

  test("is idempotent — the same session attaching twice is still one session", async () => {
    await attachSession(CWD, "s1");
    await attachSession(CWD, "s1");

    expect((await readRuntime(CWD))?.sessionIds).toEqual(["s1"]);
  });

  test("keeps several sessions", async () => {
    await attachSession(CWD, "s1");
    await attachSession(CWD, "s2");

    expect((await readRuntime(CWD))?.sessionIds.sort()).toEqual(["s1", "s2"]);
  });

  test("does nothing when no server is running", async () => {
    await expect(attachSession("/no/server/here", "s1")).resolves.toBeUndefined();
  });

  test("concurrent attaches do not lose each other", async () => {
    await Promise.all(["a", "b", "c", "d", "e"].map((id) => attachSession(CWD, id)));

    expect((await readRuntime(CWD))?.sessionIds.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("detachSession", () => {
  /**
   * The reason this exists: two Claude sessions open on one project. Closing
   * either one must not take the board away from the other.
   */
  test("reports that others remain while another session is still attached", async () => {
    await attachSession(CWD, "s1");
    await attachSession(CWD, "s2");

    expect(await detachSession(CWD, "s1")).toEqual({ remaining: 1 });
  });

  test("reports none remaining when the last session leaves", async () => {
    await attachSession(CWD, "s1");

    expect(await detachSession(CWD, "s1")).toEqual({ remaining: 0 });
  });

  test("removes only the session that left", async () => {
    await attachSession(CWD, "s1");
    await attachSession(CWD, "s2");
    await detachSession(CWD, "s1");

    expect((await readRuntime(CWD))?.sessionIds).toEqual(["s2"]);
  });

  test("detaching an unknown session is harmless", async () => {
    await attachSession(CWD, "s1");

    expect(await detachSession(CWD, "ghost")).toEqual({ remaining: 1 });
  });

  test("reports none remaining when no server is running", async () => {
    expect(await detachSession("/no/server/here", "s1")).toEqual({ remaining: 0 });
  });

  test("concurrent detaches settle on the right survivors", async () => {
    for (const id of ["a", "b", "c"]) await attachSession(CWD, id);

    await Promise.all([detachSession(CWD, "a"), detachSession(CWD, "b")]);

    expect((await readRuntime(CWD))?.sessionIds).toEqual(["c"]);
  });
});
