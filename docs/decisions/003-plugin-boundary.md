# ADR-003 — The plugin is a front door, not a layer

**Status:** Accepted
**Date:** 2026-08-13
**Decides:** what the plugin layer is allowed to contain, and which way its dependencies point

---

## Context

The plugin is how command-center reaches a user: `.claude-plugin/` manifests, `hooks/hooks.json`, three markdown slash commands, and two shell shims. It is also the newest and least stable thing in the system — the plugin API is young, and it is the one part of this codebase whose shape is decided by someone else.

That combination is the risk. A young, externally-controlled API is exactly what should *not* end up load-bearing.

## Decision

**The plugin depends on core. Core never knows the plugin exists.**

Concretely:

- The plugin layer contains **no business rules**. Which task `advance` picks, whether `finish` is legal, what `E_CONFLICT` means — all of that lives in `core/`, reached through `adapters/mutate`. The plugin's job is to translate a lifecycle event into a call and turn the answer into words.
- Nothing in `core/` or `adapters/` imports anything plugin-shaped. No `CLAUDE_PLUGIN_ROOT`, no hook payload types, no knowledge that Claude Code exists. The boundary tests enforce the direction mechanically.
- The hook surface (`src/surfaces/hook/`) is a *surface*, exactly like the CLI and the server. It sits at the same level, with the same rights, and gets no special access.

## Why this way round

**The product outlives the integration.** Everything below `surfaces/` is a task queue with a state machine, atomic persistence, and a lock. That is useful with or without Claude Code. If the plugin API changes shape — or a second host appears — the replaceable part is one directory of shims and manifests, not the system.

**It keeps the trust surface small and honest.** Plugin hooks run unsandboxed with the user's credentials, and no permission prompt gates them at install time (verified in M1). `SECURITY.md` has to state plainly what this thing does when it runs. That claim is only auditable if the plugin layer is thin enough to read in one sitting. Business logic living in a hook would make "what does this actually do on my machine" a much longer answer.

**The dependency direction is what makes the CLI honest.** Because the hook is just another surface, every operation is reachable from the terminal without Claude in the loop. That is what makes `doctor` possible, what makes the integration tests real processes rather than mocks, and what means a broken plugin degrades to a working CLI rather than to nothing.

## Consequences

- Adding a lifecycle behaviour means adding a core event and a thin surface call. If something can only be expressed inside a hook, that is the signal it was modelled in the wrong place.
- The plugin can be deleted entirely and the tool still works. That is the test of whether this boundary is real, and it currently passes.
- **One shim, `bin/cmc`, is the entire executable surface.** An earlier draft split it in two — `hooks/run` for lifecycle events, `bin/cmc` for the CLI — because the two callers genuinely have opposite contracts: a hook must **always exit 0** (a failing hook is a broken editor) and must keep stdout pure JSON because Claude Code parses it, while the CLI must report failure honestly because a human typed it and deserves a real exit code.

  That difference is real, but it does not need two files. It is a single branch on whether the first argument is `hook`, and collapsing it buys something the split cost us: *one file that describes everything this plugin executes.* Since hooks run unsandboxed with the user's credentials and `SECURITY.md` has to make an auditable claim about that, "read this one file top to bottom" is worth more than a tidy separation of two shell scripts. The shared Bun-resolution logic stops being a third file that exists only to avoid duplication.

## The contract version

The plugin manifest and the code ship together, so they can still fall out of step: a plugin updated while a session holds the old code, or a half-finished install. `hooks/hooks.json` passes `--contract 1`; `src/surfaces/hook/contract.ts` holds the version the code speaks.

A mismatch produces an explicit message naming **both** versions and the command that fixes it, delivered into the session *and* to stderr — then exits 0. The failure being designed against is the silent one: a hook that quietly does nothing, leaving someone to conclude the tool is broken with no way to find out why.

## Sessions are counted, not assumed

Two Claude sessions can be open on one project. The first draft of `SessionEnd` killed the server unconditionally, so closing either window took the board away from the other — and the `sessionIds` field on the runtime record, which exists precisely to prevent that, was never populated.

`SessionStart` now registers its session against the record and `SessionEnd` removes it; only the last session out stops the server. Both operations run under the project lock, because two sessions starting at once is the normal case rather than a rare one.

The remaining gap is honest and worth stating: a session killed outright never fires `SessionEnd`, so its id lingers and keeps the board alive with nobody watching. `cmc cleanup` reports how many sessions hold the server, and `cmc cleanup --force` stops it regardless. A stale id cannot be distinguished from a live one from the outside, so the escape hatch is deliberate rather than automatic.

## What was removed

v1's `install` and `uninstall` commands are gone, along with everything that touched `~/.claude/settings.json`. The plugin manifest declares the hooks; the user's settings file is never read or written. That was the single biggest reason to be wary of installing v1 — a tool merging JSON into the file that controls what executes in your sessions — and it is now structurally impossible rather than merely avoided.

Migration for existing v1 users is a `CHANGELOG.md` item in M9, and it must tell them how to remove the v1 hook entries that v1 wrote.
