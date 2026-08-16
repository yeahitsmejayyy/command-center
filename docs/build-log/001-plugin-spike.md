# 001 — The plugin spike: what the docs said vs. what happened

*2026-08-12 · verified against Claude Code 2.1.229, macOS arm64*

The plan for v2 had a rule at the top: don't design around assumptions, verify first. So before writing a line of the rebuild, I built a throwaway plugin called `hello-cc` — a SessionStart hook, one namespaced command, and a real 63 MB compiled binary in `bin/` — and ran it end to end.

Most of the documentation held up exactly. The interesting part is the handful of places it didn't, and the one measurement that quietly deleted an entire milestone's worth of work.

## What the docs got right

Everything load-bearing:

- SessionStart hooks fire, with `source=startup`, and their `additionalContext` genuinely lands in the session — I found the marker string in the transcript afterwards, rather than trusting that it "should" work.
- `/hello-cc:ping` appeared as a namespaced command and answered.
- `${CLAUDE_PLUGIN_ROOT}` resolves inside hook commands, alongside `${CLAUDE_PLUGIN_DATA}` and `${CLAUDE_PROJECT_DIR}`.
- A plugin really can ship an executable. The 63 MB binary kept its `-rwxr-xr-x` bit through the copy into `~/.claude/plugins/cache/` and ran from the hook. The docs never explicitly promise the executable bit survives installation; it does.

That last one mattered enough to test properly rather than reason about, because the whole distribution question hung on it.

## Four things the docs didn't say

**`bin/` on PATH is conditional.** The docs say files in `bin/` become bare commands in the Bash tool. Inside my hook, `command -v hello-bin` failed — yet dumping `$PATH` from that same hook showed *another* installed plugin's `bin/` sitting right there. The difference is install method: a marketplace-installed plugin's `bin/` reaches the hook's PATH, a `--plugin-dir` inline load's does not. Since that's precisely the gap between the development loop and the shipped product, the rule is: always use the explicit `"${CLAUDE_PLUGIN_ROOT}/bin/…"` path. Anything else works on your machine and breaks on theirs.

**SessionStart's stdin is smaller than documented.** Actual keys: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source`. The documented `prompt_id` and `permission_mode` weren't there. I only need `cwd`, so nothing broke — but this is the kind of thing you find out at 2am when it's load-bearing.

**A local-path marketplace install runs from source, not from the cache.** `CLAUDE_PLUGIN_ROOT` pointed back at my working directory even though a complete copy existed in the cache. That's a genuinely nice surprise: the development loop is live-editable, no reinstall between changes.

**`${CLAUDE_PLUGIN_DATA}` is named per install method** — `hello-cc-inline` under `--plugin-dir`, `hello-cc-hello-cc-marketplace` once properly installed. Anything cached during development is invisible to the installed copy. Any code that treats that directory as warm is wrong.

## The measurement that changed the plan

The plan assumed v2 would ship a compiled binary somehow — the only open question was *how* it reached the user's machine. Three options were on the table: bundle it in the plugin, fetch it on first run, or `npx` it every time.

Two facts killed the first option outright. There is **no platform or architecture selection mechanism** — nothing picks `darwin-arm64` over `linux-x64`, so a plugin that ships binaries ships all of them to everyone. And the size floor is structural: my one-line hello-world compiled to **63 MB**, because that's the embedded Bun runtime, not my code. Three targets is ~190 MB per install, re-downloaded on every version bump.

So I started designing the fetch-on-first-run resolver: platform detection, GitHub Releases, checksum verification, a cache in `${CLAUDE_PLUGIN_DATA}`, an offline failure path. A whole distribution pipeline.

Then, almost as an afterthought, I timed the thing:

```
compiled binary:        0.02s warm, 0.14s cold
bun run main.ts:        0.02s warm, 0.14s cold
```

Identical. Which is obvious in hindsight — a compiled Bun binary *is* the Bun runtime plus your script, and if Bun is already installed, you're shipping 63 MB to avoid using a runtime that's already sitting on the machine. I'd also confirmed that both `bun` and `node` are on the hook process's PATH, so a hook can just call one.

The compiled binary was never buying performance. It was only buying the removal of a prerequisite — and v1 already required Bun ≥ 1.3, so for every existing user it was buying nothing at all.

## What got deleted

Option D — ship the source, run it on the installed Bun — wasn't in the original plan. It is now the decision ([ADR-001](../decisions/001-binary-distribution.md)), and it removed:

- the GitHub Actions cross-platform build matrix
- checksum generation and verification
- the 63 MB first-run download
- the offline-download failure path
- two of the three tiers of the resolver shim

M7 went from "build a distribution pipeline" to "tag a release and prove the install works on a clean machine." The cost is one prerequisite, one documented `curl | bash`, for a user who by definition already runs Claude Code.

The honest trade: the plan's Definition of Done said "two commands, no manual steps." It's now three commands on a machine without Bun, and the DoD was reworded to say **no compile step** — because that was the property that actually mattered. If someone is ever genuinely blocked by the prerequisite, the fetch-based approach is written up and waiting.

## The takeaway

The spike cost maybe an hour. It corrected four documented facts, and one three-line benchmark deleted more work than any amount of careful architecture would have. The lesson isn't "docs are wrong" — they were overwhelmingly right. It's that the assumption most worth testing is usually the one nobody thought to state: in this case, *that we needed to compile anything at all.*

Next: the pure core, and the state machine transition table that gets written before its code.
