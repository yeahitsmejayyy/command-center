# 000 — Why rebuild

*2026-08-12 · the starting position*

v1 of command-center works. That needs saying first, because rewrites usually start with "the old thing was bad" and this one doesn't. It has run daily for real work: a per-project kanban board, a `cmc` CLI, a local React UI on a random loopback port, JSON state under `~/.cc-command-center/`, and Claude Code hooks keeping the board and the session in lockstep. No cloud, no accounts, no daemon. The task lifecycle — backlog → queued → in-progress → awaiting-review → done — earned its shape through use.

## What v1 got right

- **Local-first, file-based state.** JSON under a lockfile turned out to be entirely sufficient. No database was ever missed.
- **Per-project everything.** Server, state, and preferences keyed by project directory. No global mutable anything.
- **The lifecycle itself.** The five states plus a `revise` loop back to in-progress matches how review-driven agent work actually flows.
- **The hook integration concept.** SessionStart announcing the board, slash commands driving the queue — the idea is right.

## What the friction actually was

Not the product — the *seams*:

1. **Install was a gauntlet.** Clone, `bun install` twice, compile a binary, symlink it onto PATH, then `cmc install`. Six steps before the first board renders. Fine for me; disqualifying for anyone else.
2. **Hook wiring meant editing `~/.claude/settings.json`.** A tool merging JSON into the file that controls what executes in your Claude sessions is exactly the thing a cautious person should refuse to run. It also owns a file it doesn't own — uninstall means surgery.
3. **Commands copied into `~/.claude/commands/`** — unnamespaced, un-versioned, orphaned if the repo moves.
4. **Known sharp edges lived on as retries instead of fixes.** A documented ~2-second race on port allocation; a stale lock needing manual deletion after a crash. Papered over, not designed out.
5. **The architecture grew organically.** It works, but business logic, I/O, and surfaces interleave enough that the state machine can't be tested — or trusted — in isolation.

## Why the plugin system changes the calculus

Claude Code plugins invert the three worst items at once. Hooks are *declared* in a manifest instead of merged into the user's settings — install and uninstall become atomic and honest. Commands ship namespaced (`/command-center:*`) with the plugin. And install collapses to two commands: add the marketplace, install the plugin.

That's why this is a v2 and not a patch series: the distribution surface v1 was contorting around no longer exists. The rebuild keeps everything v1 proved (files, lock, lifecycle, per-project servers) and spends its effort on the seams — a pure core with an exhaustive transition table, adapters that make the port race and corruption windows structurally impossible, and a plugin front door thin enough to audit in one sitting.

v1 stays local as the read-only reference implementation. The next entry covers the plugin verification spike that decides how the binary reaches the user's machine.
