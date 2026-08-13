import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { paths } from "./paths.ts";
import { LockTimeoutError, withLock } from "./lock.ts";

const CWD = "/Users/j/dev/proj";
let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.COMMAND_CENTER_HOME;
  home = mkdtempSync(join(tmpdir(), "cc-lock-"));
  process.env.COMMAND_CENTER_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.COMMAND_CENTER_HOME;
  else process.env.COMMAND_CENTER_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

function plantLock(contents: string) {
  const path = paths.lock(CWD);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

describe("withLock", () => {
  test("returns the value the critical section produced", async () => {
    expect(await withLock(CWD, async () => 42)).toBe(42);
  });

  test("releases the lock afterwards", async () => {
    await withLock(CWD, async () => {});
    expect(existsSync(paths.lock(CWD))).toBe(false);
  });

  test("releases the lock even when the critical section throws", async () => {
    await expect(withLock(CWD, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(paths.lock(CWD))).toBe(false);
  });

  test("serialises overlapping critical sections", async () => {
    const order: string[] = [];
    const slow = withLock(CWD, async () => {
      order.push("a:start");
      await Bun.sleep(30);
      order.push("a:end");
    });
    const fast = withLock(CWD, async () => {
      order.push("b:start");
      order.push("b:end");
    });
    await Promise.all([slow, fast]);

    // b must not have interleaved into the middle of a
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  test("never runs two critical sections at once under contention", async () => {
    let inside = 0;
    let maxInside = 0;

    await Promise.all(
      Array.from({ length: 12 }, () =>
        withLock(CWD, async () => {
          inside++;
          maxInside = Math.max(maxInside, inside);
          await Bun.sleep(2);
          inside--;
        }),
      ),
    );

    expect(maxInside).toBe(1);
  });
});

describe("stale locks", () => {
  /**
   * v1's sharp edge: a crashed process left a lock file that blocked every
   * later run until someone deleted it by hand. The holder's liveness is what
   * matters, not the file's age.
   */
  test("reclaims a lock held by a process that no longer exists", async () => {
    plantLock(JSON.stringify({ pid: 999_999, at: Date.now() }));

    expect(await withLock(CWD, async () => "recovered")).toBe("recovered");
  });

  test("reclaims a lock whose contents are garbage", async () => {
    plantLock("not json at all");

    expect(await withLock(CWD, async () => "recovered")).toBe("recovered");
  });

  test("reclaims an empty lock file", async () => {
    plantLock("");

    expect(await withLock(CWD, async () => "recovered")).toBe("recovered");
  });

  test("does not steal a lock held by a live process", async () => {
    plantLock(JSON.stringify({ pid: process.pid, at: Date.now() }));

    await expect(withLock(CWD, async () => "should not run", { timeoutMs: 150 }))
      .rejects.toBeInstanceOf(LockTimeoutError);
  });

  test("the timeout error names the lock file and the holding pid", async () => {
    plantLock(JSON.stringify({ pid: process.pid, at: Date.now() }));

    try {
      await withLock(CWD, async () => {}, { timeoutMs: 100 });
      throw new Error("expected a LockTimeoutError");
    } catch (err) {
      expect(err).toBeInstanceOf(LockTimeoutError);
      expect((err as Error).message).toContain(paths.lock(CWD));
      expect((err as Error).message).toContain(String(process.pid));
    }
  });
});
