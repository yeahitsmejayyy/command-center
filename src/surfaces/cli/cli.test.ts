import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end tests: these spawn the real CLI against a temp state directory and
 * a temp project, so they exercise arg parsing, the core, the adapters, output,
 * and exit codes together. If a lifecycle can be driven here, it can be driven
 * by a human.
 */

const CLI = join(import.meta.dir, "main.ts");
let home: string;
let project: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cc-cli-home-"));
  project = mkdtempSync(join(tmpdir(), "cc-cli-proj-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: project,
    // `enable` opens the board in a browser. A test suite that launches tabs is
    // a test suite nobody runs twice.
    env: { ...process.env, COMMAND_CENTER_HOME: home, COMMAND_CENTER_NO_BROWSER: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

async function board() {
  const { stdout } = await run("list", "--json");
  return JSON.parse(stdout) as { tasks: Array<{ id: string; title: string; status: string }> };
}

describe("usage", () => {
  test("no arguments prints help and exits 2", async () => {
    const r = await run();

    expect(r.code).toBe(2);
    expect(r.stdout + r.stderr).toContain("Usage");
  });

  test("an unknown command names it and exits 2", async () => {
    const r = await run("frobnicate");

    expect(r.code).toBe(2);
    expect(r.stderr).toContain("frobnicate");
  });

  test("--help exits 0", async () => {
    const r = await run("--help");

    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage");
  });
});

describe("add and list", () => {
  test("adds a task and reports it", async () => {
    const r = await run("add", "Write the docs");

    expect(r.code).toBe(0);
    expect((await board()).tasks[0]).toMatchObject({ title: "Write the docs", status: "backlog" });
  });

  test("add requires a title", async () => {
    const r = await run("add");

    expect(r.code).toBe(2);
    expect(r.stderr.toLowerCase()).toContain("title");
  });

  test("--body and --plan are carried through", async () => {
    await run("add", "Task", "--body", "the details", "--plan");
    const { stdout } = await run("list", "--json");
    const task = JSON.parse(stdout).tasks[0];

    expect(task.body).toBe("the details");
    expect(task.planMode).toBe(true);
  });

  test("--queued puts it straight in the queue", async () => {
    await run("add", "Task", "--queued");

    expect((await board()).tasks[0]!.status).toBe("queued");
  });

  test("list --json emits parseable JSON and nothing else", async () => {
    await run("add", "One");
    const { stdout, code } = await run("list", "--json");

    expect(code).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  test("list without --json is human-readable", async () => {
    await run("add", "Readable task");
    const { stdout } = await run("list");

    expect(stdout).toContain("Readable task");
    expect(stdout).toContain("backlog");
  });

  test("an empty board says so rather than printing nothing", async () => {
    const { stdout, code } = await run("list");

    expect(code).toBe(0);
    expect(stdout.trim()).not.toBe("");
  });
});

describe("the full lifecycle, from the CLI alone", () => {
  test("add → queue → advance → finish → approve", async () => {
    await run("add", "Ship the thing", "--body", "do it well");
    const id = (await board()).tasks[0]!.id;

    expect((await run("move", id, "queued")).code).toBe(0);
    expect((await board()).tasks[0]!.status).toBe("queued");

    const advanced = await run("advance");
    expect(advanced.code).toBe(0);
    expect(advanced.stdout).toContain("do it well"); // the body is what Claude receives
    expect((await board()).tasks[0]!.status).toBe("in-progress");

    expect((await run("finish")).code).toBe(0);
    expect((await board()).tasks[0]!.status).toBe("awaiting-review");

    expect((await run("approve")).code).toBe(0);
    expect((await board()).tasks[0]!.status).toBe("done");
  });

  test("revise sends a reviewed task back to in-progress", async () => {
    await run("add", "Needs work", "--queued");
    await run("advance");
    await run("finish");

    expect((await run("revise")).code).toBe(0);
    expect((await board()).tasks[0]!.status).toBe("in-progress");
  });

  test("advance picks up the next queued task in order", async () => {
    await run("add", "First", "--queued");
    await run("add", "Second", "--queued");

    await run("advance");
    const tasks = (await board()).tasks;

    expect(tasks.find((t) => t.title === "First")?.status).toBe("in-progress");
    expect(tasks.find((t) => t.title === "Second")?.status).toBe("queued");
  });

  test("a task can be referenced by an unambiguous id prefix", async () => {
    await run("add", "Prefixed");
    const id = (await board()).tasks[0]!.id;

    expect((await run("move", id.slice(0, 6), "queued")).code).toBe(0);
    expect((await board()).tasks[0]!.status).toBe("queued");
  });
});

describe("failures are explained, and exit non-zero", () => {
  test("finish with nothing in progress", async () => {
    const r = await run("finish");

    expect(r.code).toBe(1);
    expect(r.stderr.toLowerCase()).toContain("nothing to finish");
  });

  test("advance with an empty queue", async () => {
    const r = await run("advance");

    expect(r.code).toBe(1);
    expect(r.stderr.toLowerCase()).toContain("queued");
  });

  test("advance while a task is already running names that task", async () => {
    await run("add", "Running", "--queued");
    await run("add", "Waiting", "--queued");
    await run("advance");

    const r = await run("advance");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Running");
  });

  test("approve with nothing under review", async () => {
    const r = await run("approve");

    expect(r.code).toBe(1);
    expect(r.stderr.toLowerCase()).toContain("review");
  });

  test("moving an unknown task reports the id it could not find", async () => {
    const r = await run("move", "nosuchtask", "done");

    expect(r.code).toBe(1);
    expect(r.stderr).toContain("nosuchtask");
  });

  test("an ambiguous id prefix asks for more characters instead of guessing", async () => {
    await run("add", "One");
    await run("add", "Two");
    const ids = (await board()).tasks.map((t) => t.id);
    const shared = ids[0]!.slice(0, 2);

    if (ids.every((id) => id.startsWith(shared))) {
      const r = await run("move", shared, "queued");
      expect(r.code).toBe(1);
      expect(r.stderr.toLowerCase()).toMatch(/ambiguous|matches/);
    }
  });

  test("an invalid status lists the valid ones", async () => {
    await run("add", "Task");
    const id = (await board()).tasks[0]!.id;
    const r = await run("move", id, "sideways");

    expect(r.code).toBe(1);
    expect(r.stderr).toContain("backlog");
  });

  test("starting a second task while one runs explains the conflict", async () => {
    await run("add", "Running", "--queued");
    await run("add", "Other");
    await run("advance");
    const other = (await board()).tasks.find((t) => t.title === "Other")!.id;

    const r = await run("move", other, "in-progress");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Running");
  });
});

describe("doctor", () => {
  test("reports healthy on a clean project and exits 0", async () => {
    const r = await run("doctor");

    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("bun");
  });

  test("--json emits machine-readable checks", async () => {
    const { stdout, code } = await run("doctor", "--json");

    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    for (const check of report.checks) {
      expect(typeof check.name).toBe("string");
      expect(["ok", "warn", "fail"]).toContain(check.status);
    }
  });

  test("diagnoses an unreadable state file and gives a concrete fix", async () => {
    await run("add", "Task");
    const { stdout } = await run("doctor", "--json");
    const statePath = JSON.parse(stdout).checks.find((c: { name: string }) => c.name === "state file").path;
    await Bun.write(statePath, "{ corrupted");

    const r = await run("doctor");
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("mv");
  });

  test("reports a stale lock left by a dead process", async () => {
    await run("add", "Task");
    const { stdout } = await run("doctor", "--json");
    const lockPath = JSON.parse(stdout).checks.find((c: { name: string }) => c.name === "lock").path;
    await Bun.write(lockPath, JSON.stringify({ pid: 999_999, at: Date.now() }));

    const r = await run("doctor", "--json");
    const lock = JSON.parse(r.stdout).checks.find((c: { name: string }) => c.name === "lock");
    expect(lock.status).toBe("warn");
    expect(lock.fix).toContain("rm");
  });

  /**
   * The plugin ships source, so its one runtime dependency has to actually be
   * installed. Claude Code installs it when caching the plugin — but that
   * install is documented as failing silently, and Bun will then auto-install
   * whatever version it can reach, which is not necessarily the pinned one.
   */
  test("checks that the runtime dependency is installed and the right major", async () => {
    const { stdout } = await run("doctor", "--json");
    const deps = JSON.parse(stdout).checks.find((c: { name: string }) => c.name === "dependencies");

    expect(deps).toBeDefined();
    expect(deps.status).toBe("ok");
    expect(deps.detail).toContain("zod");
  });

  test("reports no server running when there is none", async () => {
    const { stdout } = await run("doctor", "--json");
    const server = JSON.parse(stdout).checks.find((c: { name: string }) => c.name === "server");

    expect(server.status).toBe("ok");
    expect(server.detail.toLowerCase()).toContain("not running");
  });
});

describe("cleanup", () => {
  test("succeeds when there is nothing to clean", async () => {
    const r = await run("cleanup");

    expect(r.code).toBe(0);
  });

  test("stops a server that no session is using", async () => {
    await run("enable");
    expect(JSON.parse((await run("doctor", "--json")).stdout)
      .checks.find((c: { name: string }) => c.name === "server").status).toBe("ok");

    const r = await run("cleanup");
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("stopped");

    const after = JSON.parse((await run("doctor", "--json")).stdout)
      .checks.find((c: { name: string }) => c.name === "server");
    expect(after.detail.toLowerCase()).toContain("not running");
  });

  /**
   * A session that dies without SessionEnd firing leaves its id behind, which
   * would otherwise keep the board alive forever with nobody watching.
   */
  test("--force stops a server even while sessions are attached", async () => {
    await run("enable");
    await run("attach-session", "ghost-session");

    const held = await run("cleanup");
    expect(held.stdout.toLowerCase()).toContain("--force");

    const forced = await run("cleanup", "--force");
    expect(forced.code).toBe(0);

    const after = JSON.parse((await run("doctor", "--json")).stdout)
      .checks.find((c: { name: string }) => c.name === "server");
    expect(after.detail.toLowerCase()).toContain("not running");
  });

  test("reaps a runtime record whose process is gone", async () => {
    await run("add", "Task");
    const { stdout } = await run("doctor", "--json");
    const runtimePath = JSON.parse(stdout).checks.find((c: { name: string }) => c.name === "server").path;
    await Bun.write(runtimePath, JSON.stringify({
      cwd: project, pid: 999_999, port: 65000, startedAt: 1, sessionIds: [],
    }));

    const r = await run("cleanup");
    expect(r.code).toBe(0);
    expect(await Bun.file(runtimePath).exists()).toBe(false);
  });
});

describe("advance tells the agent how to hand the task back", () => {
  /**
   * The slash command says to run `cmc finish`, but that instruction is read
   * once and then buried under however much work the task takes. What the
   * agent sees *last* before starting is this payload, so the payload has to
   * carry the next step itself.
   */
  test("the started task carries the finish instruction", async () => {
    await run("add", "Add a health check", "--body", "Return 200 with uptime.", "--queued");
    const { stdout } = await run("advance");

    expect(stdout).toContain("Add a health check");
    expect(stdout).toContain("Return 200 with uptime.");
    expect(stdout).toContain("cmc finish");
  });

  test("the instruction does not appear when nothing started", async () => {
    await run("add", "Parked", "--queued");
    await run("advance");
    const { stdout } = await run("list");

    expect(stdout).not.toContain("cmc finish");
  });
});
