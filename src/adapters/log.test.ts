import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logFor } from "./log.ts";
import { paths } from "./paths.ts";

const CWD = "/Users/j/dev/proj";
let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.COMMAND_CENTER_HOME;
  home = mkdtempSync(join(tmpdir(), "cc-log-"));
  process.env.COMMAND_CENTER_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.COMMAND_CENTER_HOME;
  else process.env.COMMAND_CENTER_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

function lines(): Array<Record<string, unknown>> {
  return readFileSync(paths.log(CWD), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("logFor", () => {
  test("writes one JSON object per line", async () => {
    const log = logFor(CWD);
    await log.info("server started", { port: 1234 });

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ level: "info", msg: "server started", port: 1234 });
  });

  test("stamps every entry with a timestamp", async () => {
    await logFor(CWD).info("hello");

    expect(typeof lines()[0]!.ts).toBe("number");
  });

  test("appends rather than truncating", async () => {
    const log = logFor(CWD);
    await log.info("first");
    await log.info("second");
    await log.error("third");

    expect(lines().map((l) => l.msg)).toEqual(["first", "second", "third"]);
  });

  test("creates the log directory on first write", async () => {
    await logFor(CWD).info("creates dirs");

    expect(readFileSync(paths.log(CWD), "utf8")).toContain("creates dirs");
  });

  test("exposes its path so errors can point at it", () => {
    expect(logFor(CWD).path).toBe(paths.log(CWD));
  });

  test("survives a value that cannot be serialised", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await logFor(CWD).error("bad payload", { cyclic });

    // The entry still lands; the unserialisable field is described, not thrown.
    expect(lines()[0]).toMatchObject({ level: "error", msg: "bad payload" });
  });
});
