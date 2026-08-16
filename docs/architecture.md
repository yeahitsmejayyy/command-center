# Architecture

How command-center is put together: layer boundaries, the domain model, and the complete state machine.

> The state machine below was written *before* its implementation, deliberately, and the code was derived from it.

---

## Layers and dependency direction

Three layers, one direction. Nothing points left.

```
core/  ←  adapters/  ←  surfaces/
```

| Layer | May import | Contains | Never contains |
|---|---|---|---|
| `src/core/` | nothing but itself | domain types, the state machine | I/O, clocks, randomness, `bun:*`, `node:*` |
| `src/adapters/` | `core/` | files, locks, ports, paths, runtime records | HTTP routes, CLI arg parsing |
| `src/surfaces/` | `core/`, `adapters/` | CLI, hook entry points, HTTP server | business rules |

The boundary is enforced by a test that reads every import in `src/core/` and fails on anything outside it. A rule nobody checks is a rule that decays.

### Why core is pure

`core/` has **no clock and no randomness**. A pure `apply()` that calls `Date.now()` isn't pure, and can't be tested without freezing time. So anything non-deterministic enters as *data on the event*: timestamps arrive as `at`, identifiers as `id`, both supplied by the caller. Every test states the exact time it means, and identical input always produces identical output.

---

## Domain model

```ts
type TaskStatus = "backlog" | "queued" | "in-progress" | "awaiting-review" | "done" | "skipped"

type Task = {
  id: string
  title: string
  body: string
  status: TaskStatus
  order: number            // sort position within its column
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  attempts: number         // increments each time it enters in-progress
  planMode: boolean
  sessionId: string | null // the Claude session that last worked it
}

type ProjectState = {
  version: number          // monotonic; +1 on every successful apply
  cwd: string
  updatedAt: number
  tasks: Task[]
}
```

### Two deliberate changes from v1

**`activeTaskId` is gone.** v1 stored it on the queue *and* derived the same fact from `status === "in-progress"`, then had to keep the two in sync on every mutation — every transition carried a line like `if (q.activeTaskId === t.id) q.activeTaskId = null`. Two sources of truth for one fact is a desync waiting to happen. The active task is now derived: `tasks.find(t => t.status === "in-progress")`. Nothing to keep in sync, nothing to get wrong.

**Moving a task into `in-progress` while another is active is now rejected, not silently permitted.** v1 quietly demoted the running task back to `queued`. Since the entire premise is that Claude works one task at a time, a second task entering `in-progress` is a mistake worth naming: it returns `E_CONFLICT` identifying the task already running. The board asks you to finish or move that task first, rather than reshuffling behind your back.

### Invariants

Every one of these holds before and after every `apply()`, and each is asserted in the tests:

1. **At most one task is `in-progress`.**
2. `startedAt` is non-null exactly when the task has entered `in-progress` at least once.
3. `finishedAt` is non-null exactly when the task is in a terminal-ish state (`awaiting-review`, `done`, `skipped`), and null otherwise.
4. `attempts` never decreases, and increments exactly on entry into `in-progress`.
5. `version` increases by exactly 1 on every successful apply, and does not change on a rejection.
6. Task `id`s are unique.

---

## Events

Every mutation is an event. There is no other way to change state.

| Event | Payload | Meaning |
|---|---|---|
| `create` | `id, title, body, planMode?, status?` | add a task (defaults to `backlog`) |
| `update` | `id, title?, body?, planMode?` | edit content, never status |
| `delete` | `id` | remove a task |
| `move` | `id, to: TaskStatus` | the general escape hatch — the board's drag-and-drop |
| `reorder` | `id, order` | reposition within a column |
| `advance` | — | start the next queued task |
| `finish` | — | the active task is done being worked |
| `approve` | — | accept the task under review |
| `revise` | — | send the task under review back for more work |

Every event also carries `at: number` (the timestamp) and, where relevant, `sessionId`.

`advance`, `finish`, `approve`, and `revise` take **no task id**: they resolve their own target from state, which is where v1 put that logic too. Selection is a business rule, so it lives in core, not in the CLI.

---

## Transition table

`✓` = allowed. `—` = rejected, with the error named. Rejections leave state **completely untouched**, including `version`.

### `move` — from status (row) to status (column)

| from ↓ / to → | backlog | queued | in-progress | awaiting-review | done | skipped |
|---|---|---|---|---|---|---|
| **backlog** | no-op | ✓ | ✓¹ | ✓ | ✓ | ✓ |
| **queued** | ✓ | no-op | ✓¹ | ✓ | ✓ | ✓ |
| **in-progress** | ✓ | ✓ | no-op | ✓ | ✓ | ✓ |
| **awaiting-review** | ✓ | ✓ | ✓¹ | no-op | ✓ | ✓ |
| **done** | ✓ | ✓ | ✓¹ | ✓ | no-op | ✓ |
| **skipped** | ✓ | ✓ | ✓¹ | ✓ | ✓ | no-op |

¹ `E_CONFLICT` if a *different* task is already `in-progress`.

`move` is intentionally permissive: it is the board, and the board is the boss. A human dragging a card from `done` back to `backlog` means it. The single-active rule is the only constraint, because it is the only one the system genuinely depends on. A no-op still succeeds — it just doesn't bump `version`.

**Field effects of `move`:**

| to | startedAt | finishedAt | attempts |
|---|---|---|---|
| `backlog` | `null` | `null` | — |
| `queued` | `null` | `null` | — |
| `in-progress` | `at` | `null` | +1 |
| `awaiting-review` | — | `at` | — |
| `done` | — | `finishedAt ?? at` | — |
| `skipped` | — | `finishedAt ?? at` | — |

### Queue-scoped events — precondition and result

| Event | Precondition | Result | Rejection |
|---|---|---|---|
| `advance` | no task `in-progress`, ≥1 `queued` | lowest-`order` queued → `in-progress`, `startedAt = at`, `attempts += 1` | `E_ALREADY_ACTIVE` if one is running; `E_EMPTY_QUEUE` if none queued |
| `finish` | exactly one `in-progress` | that task → `awaiting-review`, `finishedAt = at` | `E_NO_ACTIVE_TASK` |
| `approve` | ≥1 `awaiting-review` | oldest-`finishedAt` → `done` | `E_NOTHING_TO_REVIEW` |
| `revise` | ≥1 `awaiting-review` | oldest-`finishedAt` → `in-progress`, `finishedAt = null`, `attempts += 1` | `E_NOTHING_TO_REVIEW`; `E_CONFLICT` if another task is `in-progress` |

v1 treated "nothing to advance" as a friendly no-op that exited 0. Core now returns an explicit rejection and the **CLI decides how to present it** — a missing target is still a calm message, not a stack trace. Core stays total and testable; presentation stays in the surface.

### Task-scoped events by status

| Event | backlog | queued | in-progress | awaiting-review | done | skipped |
|---|---|---|---|---|---|---|
| `update` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `delete` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `reorder` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`update` never changes status — that is `move`'s job alone, so there is exactly one path into a status change. `delete` is allowed even mid-flight; deleting the running task simply leaves nothing active.

### Universal rejections

These apply to every event, checked before the tables above:

| Error | Cause |
|---|---|
| `E_TASK_NOT_FOUND` | `id` matches no task |
| `E_DUPLICATE_ID` | `create` with an `id` already present |
| `E_INVALID_INPUT` | schema validation failed (empty title, unknown status, negative `at`) |

---

## `apply()`

```ts
apply(state: ProjectState, event: Event): Result

type Result =
  | { ok: true;  state: ProjectState; effects: Effect[] }
  | { ok: false; error: DomainError }                      // state untouched
```

Total, pure, and the only way state changes. It never throws — a rejection is a value, so every caller has to handle it.

### Effects

`apply` reports what happened; it never performs anything. Effects exist because two surfaces need the same facts: the CLI turns them into output for Claude, and M5's server pushes them to the UI. Without them each surface would re-derive "what just changed" by diffing, and they'd drift.

| Effect | Emitted when |
|---|---|
| `task-started` | a task entered `in-progress` (carries the task, so the CLI can print its body) |
| `task-finished` | a task entered `awaiting-review` |
| `task-approved` | a task entered `done` |
| `task-revised` | a task returned to `in-progress` from review |
| `queue-emptied` | the last `queued` task left the queue and none remain |

The list stays this short on purpose. An effect earns its place by having a caller that would otherwise recompute it.

---

---

## On-disk layout

State lives under `~/.command-center/`, overridable with `COMMAND_CENTER_HOME` — which is also how the test suite gets a disposable state directory per run.

```
~/.command-center/
├── state/<key>.json          the board: tasks, order, timestamps
├── runtime/<key>.json        pid, port, and attached session ids
├── locks/<key>.lock          advisory lock, holding pid inside
├── logs/<key>.log            one JSON object per line
├── preferences/<key>.json    enabled / skipped for this project
└── attachments/<key>/<taskId>/<attachmentId>
```

### The project key

`<key>` identifies a project, and `src/adapters/paths.ts` is the only module that builds one. It is a readable slug plus a hash of the canonical path:

```
/Users/j/dev/api  →  j-dev-api-4f2c8a1b09
```

Two decisions are baked into that, both of them fixes for real bugs:

**The hash is not decoration.** v1 keyed by replacing `/` with `-`, so `/a/b` and `/a-b` produced the same key and two unrelated projects silently shared a board. The slug survives for humans scanning the directory; identity comes from the hash.

**The path is canonicalised first.** `process.cwd()` returns a physical path, while a Claude Code hook receives whatever logical path the session was opened with. On macOS `/var` is a symlink to `/private/var`, so those two disagree — and the CLI and the hook would key to different projects, in the same project.

### Durability

Every write is a temp file in the same directory, flushed, then renamed over the target. `rename(2)` within a filesystem is atomic, so a reader sees the whole old file or the whole new one. The flush is what makes it survive power loss rather than merely a crash — without it the rename can land while the data is still in the page cache, leaving a correctly-named empty file.

Two protections guard concurrency, and they cover different things:

- **The lock** serialises read-modify-write within and across processes. Staleness is decided by whether the holding pid is alive, not by the file's age — a crashed run's lock is reclaimed immediately.
- **The version** catches a caller acting on state it read earlier: a browser tab open for ten minutes, a second terminal. `writeState` rejects a stale version rather than clobbering.

Code doing its own read-modify-write uses `transactState`, which holds the lock across the whole cycle, so contention becomes waiting rather than failing.

---

## Hook contract

The plugin declares two hooks in `hooks/hooks.json`, both invoking the single shim:

```
"${CLAUDE_PLUGIN_ROOT}/bin/cmc" hook session-start --contract 1
"${CLAUDE_PLUGIN_ROOT}/bin/cmc" hook session-end   --contract 1
```

### Versioning

`--contract N` is the version `hooks.json` was written against; `src/surfaces/hook/contract.ts` holds the version the code speaks. They ship together but can still fall out of step — a plugin updated mid-session, a half-finished install. A mismatch produces a message naming **both** versions and the command that fixes it, delivered into the session and to stderr, then exits 0.

The failure being designed against is the silent one: a hook that quietly does nothing, leaving someone to conclude the tool is broken with no way to find out why. `scripts/check-manifests.ts` fails CI if the two ever disagree.

### SessionStart

Receives `{ session_id, transcript_path, cwd, hook_event_name, source }` on stdin. Behaviour turns on the project's tri-state preference:

| Preference | Behaviour |
|---|---|
| unset | Offer `/command-center:enable` or `/command-center:skip`. Start nothing |
| `false` | Say nothing at all |
| `true` | Ensure a server is running, register this session, announce the board |

"Never asked" and "said no" are deliberately distinct. Collapsing them would either make the offer never appear, or start a server nobody asked for.

Output is the documented context-injection shape, verified against Claude Code 2.1.229:

```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "…" } }
```

### SessionEnd

Detaches this session from the runtime record and stops the server **only when the last session leaves**. Two Claude windows can share a project; closing one must not take the board from the other.

A session killed outright never fires the hook, so its id lingers and holds the board open. `cmc cleanup --force` is the escape hatch — a stale id cannot be told apart from a live one from outside.

### The rule the hooks obey

**Never break the session.** A task board failing is an inconvenience; a hook that errors, hangs, or blocks startup is a broken editor. Every path exits 0, including a missing Bun, a missing entry point, unparseable stdin, and an unknown event. Anything the user needs to know is said through injected context, not through a failure.

---

## Deliberately deferred

`events.jsonl` — an append-only log would buy history, undo, and debuggability, and it grows tentacles. It gets built only if a real bug during M2–M8 would have been caught by it, and that bug gets logged as the justification.
