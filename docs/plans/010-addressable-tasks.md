# M10 — Addressable tasks: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `finish`, `approve`, and `revise` can name the task they mean, so a board holding several tasks is never ambiguous about which one a verb acted on.

**Architecture:** Each of the three lifecycle events gains an optional `id`. Omitted, it resolves exactly as it does today — sole in-progress task, oldest awaiting review — so the existing loop takes the identical path. Supplied, it names that task. Prefix resolution stays in the CLI, matching `edit` and `move`; core only ever sees a full id, so it stays pure.

**Why now, and not as part of parallelism:** this fixes a defect that exists at concurrency 1. With two tasks awaiting review, a bare `cmc approve` silently takes the oldest and the user cannot tell what they approved. See [ADR-004](../decisions/004-parallel-work.md) for the full investigation; concurrency above 1 is M11 and is explicitly **not** in this plan.

**Tech stack:** TypeScript on Bun, Zod schemas as the single definition, `bun test`.

## Global Constraints

- **The single-in-progress invariant holds throughout M10.** Nothing in this plan allows two tasks to be in progress at once. `applyRevise` keeps its `conflict(active)` guard for exactly this reason.
- **Core stays pure.** No prefix matching, no I/O, no knowledge of the CLI in `src/core/`. `src/core/boundary.test.ts` enforces dependency direction — do not weaken it.
- **Backward compatible by construction.** An event with no `id` must take the current code path. A board written before this change must parse unchanged.
- **Never run `git commit`.** Project rule: Jayyy commits and pushes himself. Commit steps below produce the message as text for him to copy. Never add a co-author line.
- **Commit messages:** one line, imperative, lowercase, prefixed `M10:`.
- **`bun install` and `bun install --cwd ui` must have been run**, or `bun test` fails on modules that were never installed rather than on anything you changed.
- Run the full suite with `bun test` from the repo root. Typecheck with `bun run typecheck`.

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/core/types.ts` | Zod schemas, the single definition of an event | Modify — add optional `id` to three `EventSchema` members |
| `src/core/apply.ts` | The state machine; decides what a verb means | Modify — `applyFinish`, `applyApprove`, `applyRevise` resolve a subject |
| `src/core/apply.test.ts` | Domain behaviour | Modify — add the new cases |
| `src/surfaces/cli/main.ts` | Argument parsing and dispatch; no business logic | Modify — optional positional ref on three commands, and `USAGE` |
| `src/surfaces/cli/render.ts` | Human-facing output | Modify — the finish instruction names the task id |
| `src/surfaces/cli/cli.test.ts` | CLI behaviour end to end | Modify — add the new cases |

---

### Task 1: Optional `id` on the three lifecycle events

**Files:**
- Modify: `src/core/types.ts` — the `finish`, `approve`, `revise` members of `EventSchema`
- Modify: `src/core/apply.ts` — `applyFinish`, `applyApprove`, `applyRevise`
- Test: `src/core/apply.test.ts`

**Interfaces:**
- Consumes: `activeTask(state)`, `oldestAwaitingReview(state)`, `transition(task, to, at)`, `replace(tasks, updated)`, `commit(state, tasks, at)`, `ok`, `reject`, `notFound(id)` — all already in `apply.ts`.
- Produces: `Event` variants `{ type: "finish", at, id? }`, `{ type: "approve", at, id? }`, `{ type: "revise", at, id? }`. Task 2 constructs exactly these.

- [ ] **Step 1: Write the failing tests**

Add to `src/core/apply.test.ts`. The existing helpers `stateWith`, `expectOk`, `expectErr`, and the constant `AT` are already defined at the top of that file — do not redefine them.

```ts
describe("finish by id", () => {
  test("finishes the named task", () => {
    const state = stateWith([
      { id: "t1", status: "in-progress", startedAt: AT },
    ]);

    const r = expectOk(apply(state, { type: "finish", at: AT, id: "t1" }));

    expect(r.state.tasks[0]!.status).toBe("awaiting-review");
    expect(r.effects).toEqual([{ type: "task-finished", task: r.state.tasks[0]! }]);
  });

  test("rejects an id that is not on the board", () => {
    const state = stateWith([{ id: "t1", status: "in-progress", startedAt: AT }]);

    const r = expectErr(apply(state, { type: "finish", at: AT, id: "nope" }));

    expect(r.error.code).toBe("E_TASK_NOT_FOUND");
  });

  test("rejects a task that exists but is not in progress", () => {
    const state = stateWith([{ id: "t1", status: "queued" }]);

    const r = expectErr(apply(state, { type: "finish", at: AT, id: "t1" }));

    expect(r.error.code).toBe("E_CONFLICT");
    expect(r.error.taskId).toBe("t1");
  });

  test("without an id, still finishes the sole in-progress task", () => {
    const state = stateWith([
      { id: "t1", status: "queued" },
      { id: "t2", status: "in-progress", startedAt: AT },
    ]);

    const r = expectOk(apply(state, { type: "finish", at: AT }));

    expect(r.state.tasks[1]!.status).toBe("awaiting-review");
    expect(r.state.tasks[0]!.status).toBe("queued");
  });
});

describe("approve by id", () => {
  test("approves the named task, not the oldest", () => {
    const state = stateWith([
      { id: "older", status: "awaiting-review", finishedAt: AT },
      { id: "newer", status: "awaiting-review", finishedAt: AT + 1000 },
    ]);

    const r = expectOk(apply(state, { type: "approve", at: AT, id: "newer" }));

    expect(r.state.tasks.find((t) => t.id === "newer")!.status).toBe("done");
    expect(r.state.tasks.find((t) => t.id === "older")!.status).toBe("awaiting-review");
  });

  test("without an id, still approves the oldest", () => {
    const state = stateWith([
      { id: "older", status: "awaiting-review", finishedAt: AT },
      { id: "newer", status: "awaiting-review", finishedAt: AT + 1000 },
    ]);

    const r = expectOk(apply(state, { type: "approve", at: AT }));

    expect(r.state.tasks.find((t) => t.id === "older")!.status).toBe("done");
    expect(r.state.tasks.find((t) => t.id === "newer")!.status).toBe("awaiting-review");
  });

  test("rejects a task that is not awaiting review", () => {
    const state = stateWith([{ id: "t1", status: "done", finishedAt: AT }]);

    const r = expectErr(apply(state, { type: "approve", at: AT, id: "t1" }));

    expect(r.error.code).toBe("E_CONFLICT");
  });
});

describe("revise by id", () => {
  test("revises the named task", () => {
    const state = stateWith([
      { id: "older", status: "awaiting-review", finishedAt: AT },
      { id: "newer", status: "awaiting-review", finishedAt: AT + 1000 },
    ]);

    const r = expectOk(apply(state, { type: "revise", at: AT, id: "newer" }));

    expect(r.state.tasks.find((t) => t.id === "newer")!.status).toBe("in-progress");
    expect(r.state.tasks.find((t) => t.id === "older")!.status).toBe("awaiting-review");
  });

  test("still refuses while another task is in progress", () => {
    const state = stateWith([
      { id: "running", status: "in-progress", startedAt: AT },
      { id: "reviewed", status: "awaiting-review", finishedAt: AT },
    ]);

    const r = expectErr(apply(state, { type: "revise", at: AT, id: "reviewed" }));

    expect(r.error.code).toBe("E_CONFLICT");
    expect(r.error.taskId).toBe("running");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/core/apply.test.ts`

Expected: the `by id` cases fail. Because Zod strips unknown keys rather than erroring, `{ type: "finish", at, id: "t1" }` currently parses with `id` discarded, so expect wrong-task assertions and `expected rejection, got ok` — **not** a parse error. If you instead see `E_INVALID_INPUT`, the schema change from Step 3 has already been applied; revert it and re-run so you have seen the tests fail for the right reason.

- [ ] **Step 3: Add `id` to the three event schemas**

In `src/core/types.ts`, inside `EventSchema`, replace the three bare members:

```ts
  z.object({ ...base, type: z.literal("finish"), id: z.string().min(1).optional() }),
  z.object({ ...base, type: z.literal("approve"), id: z.string().min(1).optional() }),
  z.object({ ...base, type: z.literal("revise"), id: z.string().min(1).optional() }),
```

Leave `advance` alone. It already carries `sessionId` and gains nothing here.

- [ ] **Step 4: Resolve a subject in the three handlers**

In `src/core/apply.ts`, add this helper next to `oldestAwaitingReview`:

```ts
/**
 * The task a lifecycle verb acts on.
 *
 * `id` omitted keeps the historical behaviour — the verb picks its own subject
 * from the board. Supplied, it names one, and a named task that is in the wrong
 * state is a conflict rather than a miss: it exists, it just cannot be moved
 * from where it is.
 */
function subject(
  state: ProjectState,
  id: string | undefined,
  required: TaskStatus,
  fallback: (s: ProjectState) => Task | undefined,
  emptyCode: "E_NO_ACTIVE_TASK" | "E_NOTHING_TO_REVIEW",
  emptyMessage: string,
): { task: Task } | { error: Result } {
  if (id === undefined) {
    const found = fallback(state);
    return found ? { task: found } : { error: reject(emptyCode, emptyMessage) };
  }

  const named = state.tasks.find((t) => t.id === id);
  if (!named) return { error: notFound(id) };
  if (named.status !== required) {
    return {
      error: reject(
        "E_CONFLICT",
        `"${named.title}" is ${LABEL_FOR_ERROR[named.status]}, not ${LABEL_FOR_ERROR[required]}.`,
        named.id,
      ),
    };
  }
  return { task: named };
}

/** Status wording for conflict messages, written for a confused human. */
const LABEL_FOR_ERROR: Record<TaskStatus, string> = {
  backlog: "in the backlog",
  queued: "queued",
  "in-progress": "in progress",
  "awaiting-review": "awaiting review",
  done: "done",
  skipped: "skipped",
};
```

Then rewrite the three handlers:

```ts
function applyFinish(state: ProjectState, e: Extract<ParsedEvent, { type: "finish" }>): Result {
  const found = subject(
    state,
    e.id,
    "in-progress",
    activeTask,
    "E_NO_ACTIVE_TASK",
    "No task is in progress, so there is nothing to finish.",
  );
  if ("error" in found) return found.error;

  const finished = transition(found.task, "awaiting-review", e.at);
  return ok(commit(state, replace(state.tasks, finished), e.at), [
    { type: "task-finished", task: finished },
  ]);
}

function applyApprove(state: ProjectState, e: Extract<ParsedEvent, { type: "approve" }>): Result {
  const found = subject(
    state,
    e.id,
    "awaiting-review",
    oldestAwaitingReview,
    "E_NOTHING_TO_REVIEW",
    "No task is awaiting review.",
  );
  if ("error" in found) return found.error;

  const approved = transition(found.task, "done", e.at);
  return ok(commit(state, replace(state.tasks, approved), e.at), [
    { type: "task-approved", task: approved },
  ]);
}

function applyRevise(state: ProjectState, e: Extract<ParsedEvent, { type: "revise" }>): Result {
  const found = subject(
    state,
    e.id,
    "awaiting-review",
    oldestAwaitingReview,
    "E_NOTHING_TO_REVIEW",
    "No task is awaiting review.",
  );
  if ("error" in found) return found.error;

  // Still one at a time in M10: sending work back must not create a second
  // in-progress task. M11 is what lifts this, together with a real limit.
  const active = activeTask(state);
  if (active) return conflict(active);

  const revised = transition(found.task, "in-progress", e.at);
  return ok(commit(state, replace(state.tasks, revised), e.at), [
    { type: "task-revised", task: revised },
  ]);
}
```

Add `Task` and `TaskStatus` to the existing type import from `./types.ts` if they are not already imported.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/core/apply.test.ts`
Expected: PASS, including the pre-existing `finish`, `approve`, and `revise` tests — they cover the no-id path and must not have changed behaviour.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all green. `src/core/compatibility.test.ts` and `src/core/boundary.test.ts` in particular must still pass.

- [ ] **Step 7: Hand over the commit message**

Print this for Jayyy — do not run it:

```
M10: let the lifecycle verbs name the task they act on
```

---

### Task 2: Optional positional task reference on the CLI

**Files:**
- Modify: `src/surfaces/cli/main.ts` — the `finish` / `approve` / `revise` cases, `USAGE`
- Test: `src/surfaces/cli/cli.test.ts`

**Interfaces:**
- Consumes: the events from Task 1; `resolveTask(state, ref)` returning `{ task }` or `{ error, hint }`; `readState(cwd)`; `runEvent(cwd, event)`; `fail(message, hint)`; `EXIT_USAGE`.
- Produces: `cmc finish [task]`, `cmc approve [task]`, `cmc revise [task]` accepting a full or prefix id.

- [ ] **Step 1: Write the failing tests**

Add to `src/surfaces/cli/cli.test.ts`, following that file's existing pattern for invoking the CLI against a temp project directory. Match the surrounding helpers rather than inventing new ones — read the top of the file first.

```ts
describe("finish with a task reference", () => {
  test("finishes the named task by id prefix", async () => {
    const project = await tempProject();
    await run(project, ["add", "first", "--queued"]);
    await run(project, ["add", "second", "--queued"]);
    await run(project, ["advance"]);

    const board = await readState(project);
    const running = board.tasks.find((t) => t.status === "in-progress")!;

    const result = await run(project, ["finish", running.id.slice(0, 8)]);

    expect(result.code).toBe(0);
    const after = await readState(project);
    expect(after.tasks.find((t) => t.id === running.id)!.status).toBe("awaiting-review");
  });

  test("an unknown reference fails with the board hint", async () => {
    const project = await tempProject();
    await run(project, ["add", "first", "--queued"]);
    await run(project, ["advance"]);

    const result = await run(project, ["finish", "zzzz"]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('No task matches "zzzz"');
  });

  test("no reference still finishes the running task", async () => {
    const project = await tempProject();
    await run(project, ["add", "only", "--queued"]);
    await run(project, ["advance"]);

    const result = await run(project, ["finish"]);

    expect(result.code).toBe(0);
    const after = await readState(project);
    expect(after.tasks[0]!.status).toBe("awaiting-review");
  });
});

describe("approve with a task reference", () => {
  test("approves the named task rather than the oldest", async () => {
    const project = await tempProject();
    await run(project, ["add", "first", "--queued"]);
    await run(project, ["advance"]);
    await run(project, ["finish"]);
    await run(project, ["add", "second", "--queued"]);
    await run(project, ["advance"]);
    await run(project, ["finish"]);

    const board = await readState(project);
    const second = board.tasks.find((t) => t.title === "second")!;

    const result = await run(project, ["approve", second.id]);

    expect(result.code).toBe(0);
    const after = await readState(project);
    expect(after.tasks.find((t) => t.title === "second")!.status).toBe("done");
    expect(after.tasks.find((t) => t.title === "first")!.status).toBe("awaiting-review");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/surfaces/cli/cli.test.ts`
Expected: FAIL — the positional argument is currently ignored, so `finish <ref>` finishes whatever is running and `approve <id>` approves the oldest.

- [ ] **Step 3: Resolve the reference in the dispatcher**

In `src/surfaces/cli/main.ts`, add this helper beside `resolveTask`:

```ts
/**
 * Turn an optional positional task reference into an id for a lifecycle event.
 *
 * Resolution happens here, not in core: prefix matching is a terminal
 * affordance, and core only ever sees a full id. Reading state outside the lock
 * to resolve it is the same thing `edit` and `move` already do — the worst case
 * is a reference that was valid a moment ago and is now rejected by the domain,
 * which is a correct answer either way.
 */
async function lifecycleId(
  cwd: string,
  args: Args,
): Promise<{ id?: string } | { usage: true }> {
  const ref = args.positional[0];
  if (!ref) return {};

  const state = await readState(cwd);
  const resolved = resolveTask(state, ref);
  if ("error" in resolved) {
    fail(resolved.error, resolved.hint);
    return { usage: true };
  }
  return { id: resolved.task.id };
}
```

Replace the three dispatch cases:

```ts
    case "finish":
    case "approve":
    case "revise": {
      const picked = await lifecycleId(cwd, args);
      if ("usage" in picked) return EXIT_USAGE;
      return runEvent(cwd, { type: args.command, at: now(), ...picked });
    }
```

Confirm `args.command` narrows to the three literals in that block. If TypeScript widens it to `string`, write the three cases out separately rather than reaching for a cast.

- [ ] **Step 4: Update `USAGE`**

In the `Working the queue` block of the `USAGE` string, replace the three lines:

```
  finish [task]        Send a running task to review (default: the running one)
  approve [task]       Accept a task under review (default: the oldest)
  revise [task]        Send a task under review back for more work
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/surfaces/cli/cli.test.ts`
Expected: PASS, with the pre-existing no-argument tests still green.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all green.

- [ ] **Step 7: Hand over the commit message**

```
M10: accept a task reference on finish, approve, and revise
```

---

### Task 3: The task payload names its own id

**Files:**
- Modify: `src/surfaces/cli/render.ts` — `renderTaskForClaude`
- Modify: `commands/start.md`
- Test: `src/surfaces/cli/cli.test.ts` (or wherever `renderTaskForClaude` is currently asserted — grep for `ready for review` and `awaiting review` first)

**Interfaces:**
- Consumes: `Task` from core; the CLI surface from Task 2.
- Produces: no new interface. Output copy only.

- [ ] **Step 1: Write the failing test**

```ts
test("the payload tells the agent to finish this specific task", () => {
  const task: Task = {
    id: "t_abc123",
    title: "Fix the thing",
    body: "do it",
    status: "in-progress",
    order: 0,
    createdAt: 1,
    startedAt: 1,
    finishedAt: null,
    attempts: 1,
    planMode: false,
    sessionId: null,
    attachments: [],
  };

  expect(renderTaskForClaude(task)).toContain("cmc finish t_abc123");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test -t "finish this specific task"`
Expected: FAIL — the payload currently says a bare `cmc finish`.

- [ ] **Step 3: Name the id in the instruction**

In `src/surfaces/cli/render.ts`, in `renderTaskForClaude`, replace the final `sections.push(...)`:

```ts
  // The slash command already says to run `finish`, but that is read once and
  // then buried under however much work the task takes. This payload is the
  // last thing the agent sees before starting, so it carries the next step —
  // and names the task, so the instruction stays correct on a board that has
  // more than one thing on it.
  sections.push(
    "",
    "---",
    "",
    `When the work is done, run \`cmc finish ${task.id}\` to move this to awaiting review, ` +
      "then wait for the user's verdict rather than starting the next task.",
  );
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test -t "finish this specific task"`
Expected: PASS.

- [ ] **Step 5: Update the slash command**

In `commands/start.md`, change the finish instruction so the id comes from the payload rather than being implied. Replace the bare `cmc finish` command block with:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/cmc" finish <the task id from the output above>
```

Keep the surrounding prose about waiting for the user's verdict. Match the file's existing quoting of the binary path exactly — do not switch to a bare `cmc`.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all green.

- [ ] **Step 7: Verify by hand, on the real board**

This is the part a test cannot cover. With two tasks awaiting review:

```bash
cmc list
```

Approve the *newer* one by id and confirm the older one stays put. That is the defect this milestone exists to fix, so see it work.

- [ ] **Step 8: Hand over the commit message**

```
M10: carry the task id in the finish instruction
```

---

## Self-review notes

- **Spec coverage.** ADR-004's decision 1 (optional id) is Task 1; the CLI surface is Task 2; the payload and command copy are Task 3. ADR-004's decisions 2 and 3 — orchestrator-owned dispatch and the concurrency preference — are deliberately **not** here; they are M11.
- **The `revise` guard is intentional.** It is the one place this plan declines to generalise, because lifting it would break the single-in-progress invariant that M10 promises to preserve. It is called out in the code comment so M11 knows where to look.
- **No agent label in M10.** `advance --agent <label>` has no consumer until more than one task can run, so it waits for M11 rather than shipping dormant.
- **Known limitation:** resolving a prefix outside the lock is a benign time-of-check race, identical to the one `edit` and `move` already accept. Documented in `lifecycleId`'s comment rather than fixed, because the domain rejects a stale reference correctly anyway.
