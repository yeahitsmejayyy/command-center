import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { paths } from "./paths.ts";
import { readPrefs, setEnabled } from "./prefs.ts";

const CWD = "/Users/j/dev/proj";
let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.COMMAND_CENTER_HOME;
  home = mkdtempSync(join(tmpdir(), "cc-prefs-"));
  process.env.COMMAND_CENTER_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.COMMAND_CENTER_HOME;
  else process.env.COMMAND_CENTER_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

describe("readPrefs", () => {
  /**
   * "Undecided" has to be distinguishable from "chose no". The SessionStart
   * hook offers a choice on the first run and must stay silent afterwards —
   * defaulting an untouched project to disabled would make the offer never
   * appear, and defaulting to enabled would launch a server nobody asked for.
   */
  test("a project that has never been asked is undecided", async () => {
    expect(await readPrefs(CWD)).toEqual({ enabled: null });
  });

  test("remembers an enable", async () => {
    await setEnabled(CWD, true);

    expect((await readPrefs(CWD)).enabled).toBe(true);
  });

  test("remembers a skip", async () => {
    await setEnabled(CWD, false);

    expect((await readPrefs(CWD)).enabled).toBe(false);
  });

  test("a later choice replaces the earlier one", async () => {
    await setEnabled(CWD, false);
    await setEnabled(CWD, true);

    expect((await readPrefs(CWD)).enabled).toBe(true);
  });

  test("preferences are per project", async () => {
    await setEnabled(CWD, true);

    expect((await readPrefs("/Users/j/dev/other")).enabled).toBeNull();
  });

  test("an unreadable preferences file reads as undecided rather than throwing", async () => {
    const path = paths.prefs(CWD);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ corrupted");

    expect(await readPrefs(CWD)).toEqual({ enabled: null });
  });

  test("a file with an unexpected shape reads as undecided", async () => {
    const path = paths.prefs(CWD);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ enabled: "yes please" }));

    expect(await readPrefs(CWD)).toEqual({ enabled: null });
  });
});
