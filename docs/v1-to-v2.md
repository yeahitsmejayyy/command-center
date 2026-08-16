# command-center: v1 → v2, explained

A plain-language breakdown of what changed between [v1](https://github.com/yeahitsmejayyy/command-center-v1) and the current rebuild.

**Three versions of the same answer, shortest first.** Send the TL;DR to most people, the matrix to anyone who wants specifics, the conversational version if they're actually interested.

---

## TL;DR

*Copy-paste from here.*

> **command-center** is a local task board that keeps a kanban queue and a Claude Code session in sync. Everything runs on your machine — no accounts, no cloud, no daemon.
>
> v1 worked and I used it daily. v2 rebuilds the *seams* around it, not the product:
>
> - **Install went from 6 steps to 2** — and it never touches `~/.claude/settings.json` anymore. Hooks are declared in the plugin manifest instead.
> - **The 58 MB binary is gone.** I timed it: running the source on Bun is exactly as fast, because a compiled Bun binary *is* the runtime plus your script — and Bun was already installed.
> - **Three enforced layers** (pure core → adapters → surfaces), one `apply(state, event)` function for every state change, and the full transition table written before the code.
> - **The known races are designed out rather than retried** — port allocation, stale locks, crash-safe writes.
> - **0 tests → 245 tests**, which turned up a real bug: two unrelated projects could silently share one board.
>
> Unchanged: local-first, JSON files under a lock, no database, no daemon, same task lifecycle.

---

## The matrix

### Install & distribution

| | v1 | v2 |
|---|---|---|
| **Install** | Clone, `bun install` ×2, compile a binary, symlink onto PATH, `cmc install` | `/plugin marketplace add` + `/plugin install` |
| **Compile step** | Yes — user builds a 58 MB binary | **None.** Ships source, runs on the Bun already installed |
| **Why no binary** | — | Measured: `bun run source` and the compiled binary are both 0.02s warm. The binary was 63 MB of embedded runtime buying nothing |
| **Hook wiring** | Merges JSON into `~/.claude/settings.json` | Declared in the plugin manifest. **settings.json is never read or written** |
| **Slash commands** | Copied into `~/.claude/commands/`, unnamespaced | Shipped by the plugin, namespaced `/command-center:*` |
| **Uninstall** | Manual surgery on settings.json | Remove the plugin |
| **Offline** | Untested | Verified: nothing is fetched at runtime |

### Architecture

| | v1 | v2 |
|---|---|---|
| **Structure** | Organically grown; logic, I/O and surfaces interleaved | Three layers: `core/` (pure) → `adapters/` (I/O) → `surfaces/` (CLI, hook, server) |
| **Boundaries** | Convention | Enforced by tests that read the actual imports and fail on a violation |
| **State changes** | Scattered across command files | One pure function: `apply(state, event) → { state, effects }` |
| **Transition rules** | Implicit in the code | An exhaustive table written **before** the code, with every status × event pair tested |
| **Purity** | — | `core/` has no clock, no randomness, no I/O. Timestamps and ids arrive on the event, so every test is deterministic |
| **Tests** | 0 test files | 245 tests, ~5s |

### Bugs fixed by design

| Problem | v1 | v2 |
|---|---|---|
| **Project identity collision** | `/a/b` and `/a-b` encoded to the same key — two unrelated projects silently shared one board | Readable slug + hash of the full path |
| **Symlinked paths** | CLI and hook could key to different projects (on macOS `/var` → `/private/var`) | Paths canonicalized through `realpath` |
| **Port allocation** | Bind port 0, **close it**, hand the number to a child that rebinds — a documented ~2s race, retried | The server binds its own port and reports it off the live socket. The race doesn't exist |
| **Crash mid-write** | tmp + rename, no `fsync` — a power cut could leave a correctly-named empty file | Write → fsync → rename, temp file in the same directory |
| **Stale lock after a crash** | Detected by file age (10s), documented fix was `rm` by hand | Detected by whether the holding process is alive — reclaimed instantly |
| **Concurrent writes** | Last write wins | Lock + version check; the whole read-modify-write runs inside the lock |
| **Two sources of truth** | `activeTaskId` stored *and* derivable from status, kept in sync by hand | Derived only |
| **Two tasks in progress** | Silently demoted the running task | Rejected with an error naming the task that's blocking you |

### Day-to-day behaviour

| | v1 | v2 |
|---|---|---|
| **Board updates** | UI polls every 750 ms, per tab, full state | SSE push. One shared server-side check, so cost is flat no matter how many tabs |
| **Changes made by Claude** | Picked up on the next poll | Detected the same way as UI changes — the server watches the file, not the request |
| **Errors** | Sometimes a stack trace | Every failure names what happened and what to run |
| **Diagnostics** | — | `cmc doctor`: 6 named checks, each with a runnable fix |
| **Multiple sessions** | — | Sessions counted; the board only stops when the last one closes |

### What deliberately did *not* change

Local-first. JSON files under a lock — no database. No daemon; servers are per-project and bound to sessions. Loopback only. Same task lifecycle: `backlog → queued → in-progress → awaiting-review → done`, with `revise` sending work back.

**Status:** M0–M7 complete. Remaining: the UI rebuild, and docs/security/ship.

---

## The conversational version

*Copy-paste from here.*

> command-center is a local task board that keeps a kanban queue and a Claude Code session in sync. You drop tasks on the board, Claude pulls the next one, does it, and moves it to review. Everything runs on your machine — no accounts, no cloud, no background daemon.
>
> v1 worked and I used it daily. v2 isn't a rewrite because v1 was bad; it's a rewrite because the *seams* were bad.
>
> **Installing it used to be the worst part.** Clone the repo, `bun install` twice, compile a 58 MB binary, symlink it onto your PATH, then run an installer that merged JSON into `~/.claude/settings.json`. Six steps, and the last one edits the file that controls what executes in your Claude sessions — which is exactly the thing a cautious person should refuse to run. Now it's two commands: add the marketplace, install the plugin. The hooks are declared in the plugin manifest, so settings.json is never touched at all.
>
> **The binary is gone entirely.** This was the fun one. I was about to build a whole distribution pipeline — cross-platform builds, checksums, download-on-first-run — and then I timed it. Running the TypeScript directly on Bun: 0.02s. The compiled binary: 0.02s. Identical, because a compiled Bun binary *is* the Bun runtime plus your script, and Bun was already on the machine. It was 63 MB of embedded runtime buying nothing. So v2 just ships source. That deleted a build matrix, checksum verification, the first-run download, and the offline failure path.
>
> **The architecture is three layers with one direction.** A pure core with the state machine, adapters for anything touching the disk, and surfaces on top (CLI, hook, HTTP server). The core has no clock and no randomness — timestamps and ids come in *on the event* — so it's genuinely deterministic and every test states the exact moment it means. The layer boundaries are enforced by tests that read the imports and fail on a violation, because a rule nobody checks decays.
>
> **Every state change goes through one function.** `apply(state, event)` returns the new state plus what happened. I wrote the full transition table — every status against every event, including the illegal ones — before writing the code, and there's a test for every cell. v1 had zero tests; v2 has 245.
>
> **Then there were the known-sharp-edges.** v1 had a couple of documented "yeah, that races sometimes" issues, and rebuilding was a chance to make them structurally impossible instead of retried:
>
> - Port allocation used to bind a port, **close it**, then hand the number to a child process to rebind — leaving a two-second window where anything could steal it. Now the server binds its own port and reports it off the still-open socket. There's no window to lose.
> - The lock file decided a crashed process was stale based on the file's *age*. It's now based on whether that process still exists, so a dead holder's lock is reclaimed immediately instead of blocking you for the timeout.
> - Writes were tmp + rename, which is right, but with no `fsync` — so a power cut could leave you a correctly-named empty board.
>
> **And one bug nobody knew about.** v1 keyed each project's state by replacing `/` with `-` in the path. So `/a/b` and `/a-b` both became `a-b`, and two unrelated projects would silently share one board. No error, just tasks showing up in the wrong place. That's now the first regression test in the suite. A related one turned up during v2: on macOS `/var` is a symlink to `/private/var`, so the CLI and the hook could disagree about which project they were in — enable the board in one and the other reports the project as untouched. Paths are canonicalized now.
>
> **The board updates differently too.** v1 polled every 750 ms from every open tab. The catch is that changes come from two directions — the UI over HTTP, and Claude running a command in a totally separate process. So v2's server watches the state file rather than its own request handlers, and pushes over SSE. One check, shared by every connected client, and it catches changes no matter who made them.
>
> What didn't change: still local-first, still JSON files under a lock, still no database and no daemon, same task lifecycle. The rebuild was about the parts around the product, not the product.

---

*Deeper reading: [architecture.md](architecture.md) for the state machine and layer rules, [decisions/](decisions/) for why each major call was made, [build-log/](build-log/) for the narrative including what broke along the way.*
