import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeCwd, paths, stateRoot } from "./paths.ts";

describe("encodeCwd", () => {
  test("is deterministic", () => {
    expect(encodeCwd("/Users/j/dev/proj")).toBe(encodeCwd("/Users/j/dev/proj"));
  });

  test("stays readable — the project name survives in the key", () => {
    expect(encodeCwd("/Users/j/dev/my-proj")).toContain("my-proj");
  });

  /**
   * v1 encoded by replacing "/" with "-", so /a/b and /a-b both became "a-b"
   * and two unrelated projects silently shared one state file.
   */
  test("does not collide when a path contains the separator it encodes to", () => {
    expect(encodeCwd("/a/b")).not.toBe(encodeCwd("/a-b"));
  });

  test("distinguishes paths that differ only deep in the tree", () => {
    expect(encodeCwd("/Users/j/work/api")).not.toBe(encodeCwd("/Users/j/home/api"));
  });

  test("produces a filesystem-safe key", () => {
    for (const cwd of ["/a/b", "/Users/j/My Project", "/tmp/x.y", "/weird/../path"]) {
      expect(encodeCwd(cwd)).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  test("treats trailing slashes as the same project", () => {
    expect(encodeCwd("/Users/j/proj/")).toBe(encodeCwd("/Users/j/proj"));
  });

  /**
   * A project reached through a symlink is the same project.
   *
   * This is not exotic: on macOS /var and /tmp are themselves symlinks, so the
   * CLI (which sees the resolved physical path from process.cwd()) and a
   * Claude Code hook (which is handed the logical path) can disagree about
   * which project they are in — one enables the board, the other reports the
   * project as untouched.
   */
  test("a symlinked path and its target are the same project", () => {
    const real = mkdtempSync(join(tmpdir(), "cc-real-"));
    const link = join(mkdtempSync(join(tmpdir(), "cc-link-")), "alias");
    symlinkSync(real, link);

    try {
      expect(encodeCwd(link)).toBe(encodeCwd(real));
    } finally {
      rmSync(link, { force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });

  test("a path that does not exist still encodes without throwing", () => {
    expect(() => encodeCwd("/definitely/not/here/at/all")).not.toThrow();
  });
});

describe("paths", () => {
  const cwd = "/Users/j/dev/proj";

  test("every project path lives under the state root", () => {
    const root = stateRoot();
    for (const p of [paths.state(cwd), paths.lock(cwd), paths.runtime(cwd), paths.log(cwd), paths.prefs(cwd)]) {
      expect(p.startsWith(root)).toBe(true);
    }
  });

  test("each concern gets its own file", () => {
    const all = [paths.state(cwd), paths.lock(cwd), paths.runtime(cwd), paths.log(cwd), paths.prefs(cwd)];
    expect(new Set(all).size).toBe(all.length);
  });

  test("different projects never share a file", () => {
    expect(paths.state("/a/b")).not.toBe(paths.state("/a-b"));
  });

  test("honours the COMMAND_CENTER_HOME override", () => {
    const prev = process.env.COMMAND_CENTER_HOME;
    process.env.COMMAND_CENTER_HOME = "/tmp/cc-test-home";
    try {
      expect(stateRoot()).toBe("/tmp/cc-test-home");
      expect(paths.state(cwd).startsWith("/tmp/cc-test-home")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.COMMAND_CENTER_HOME;
      else process.env.COMMAND_CENTER_HOME = prev;
    }
  });
});
