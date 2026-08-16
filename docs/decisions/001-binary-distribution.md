# ADR-001 — Binary distribution

**Status:** **Accepted — Option D** (Jayyy, at the M1 gate, 2026-08-12)
**Date:** 2026-08-12
**Decides:** how `cmc` reaches a user's machine, which determines the shape of M6 (resolver shim) and M7 (distribution)

---

## Context

v1 made the user compile the binary: clone, `bun install` twice, `bun build --compile`, symlink onto PATH. v2's premise is that the binary should be invisible. The question is how.

M1's spike settled the facts this decision rests on. All of these are verified on Claude Code 2.1.229, not inferred — details in [plugin-platform.md](../plugin-platform.md).

1. **Plugins can ship executables and they work.** A 63 MB compiled binary in `bin/` kept its `-rwxr-xr-x` bit through the copy into `~/.claude/plugins/cache/` and ran successfully from a SessionStart hook.
2. **There is no platform or architecture selection mechanism.** Nothing picks `cmc-darwin-arm64` over `cmc-linux-x64`. A plugin that ships binaries ships every one of them to every user.
3. **The size floor is structural.** A one-line hello-world compiles to **63 MB**; v1's full CLI is 58 MB. That is the embedded Bun runtime, not our code, so it will not shrink.
4. **`--ignore-scripts` kills postinstall for git-sourced plugins.** Claude Code installs a plugin's node dependencies with `npm ci --ignore-scripts` / `bun install --frozen-lockfile --ignore-scripts`, and a failed or skipped install never blocks the plugin — it fails silently. **Exception:** fetching an *npm-source* plugin runs `npm install` with lifecycle scripts enabled.
5. **Both runtimes are already reachable from a hook** on this machine: `bun 1.3.14` and `node v22.12.0`, both on the hook process's PATH.
6. **Compiling buys no speed.** `bun run src/cli/main.ts list` and `./bin/cmc list` both measure 0.02s warm, 0.14s cold. The binary's *only* benefit is removing the runtime prerequisite.

Fact 6 is the one that reframes the question. This was never a performance decision — it is purely about whether we accept a runtime prerequisite, and what we're willing to build to avoid one.

---

## Options

### A — Plugin ships all platform binaries in `bin/`

Verified to work, and the best possible UX in principle: install the plugin, everything is present, works offline forever.

Killed by arithmetic. Three targets (`darwin-arm64`, `darwin-x64`, `linux-x64`) at ~63 MB is **~190 MB per install**, re-downloaded on every version bump, with each version kept in its own cache directory for ~14 days after being orphaned. A user on their third update could be holding half a gigabyte for a kanban board. There is no mechanism to send only the relevant binary.

**Rejected on size.**

### B — Resolver fetches a prebuilt binary into `${CLAUDE_PLUGIN_DATA}` on first run

The plugin stays tiny (well under 1 MB). A shim detects platform and architecture, downloads the matching binary from a GitHub Release, verifies its checksum, caches it in `${CLAUDE_PLUGIN_DATA}` (which survives plugin updates), and execs it.

Works with git-source distribution, so `/plugin marketplace add` from GitHub stays the front door. No runtime prerequisite at all — the strongest argument in its favour, and it's a real one.

The cost is an entire distribution pipeline: a GitHub Actions release matrix, checksum generation and verification, a first-run network dependency, a cold-start download of 63 MB, an offline failure path that must explain itself, and a resolver with three fallback tiers where each error path needs a real message. That is essentially all of M7 plus the hardest part of M6.

It also has a sharp edge the spike found: `${CLAUDE_PLUGIN_DATA}` is named per install method (`command-center-inline` under `--plugin-dir` versus `command-center-<marketplace>` when installed), so a binary cached during development is invisible to the installed copy. The resolver must tolerate a cold data directory on every path.

### C — Hooks call `npx -y <package>@latest`

Zero install and always current, but it puts a registry fetch on the critical path of *every* SessionStart, adds cold-start latency to the one moment the user is waiting, and silently breaks offline. `@latest` also means the tool can change under the user mid-session with no version pinning. Distribution is forced onto npm.

**Rejected.** Session startup is the worst possible place to spend a network round-trip.

### D — Ship the source; run it with a runtime that's already there *(not in the original plan)*

No compilation, no binary, no download. The plugin ships its TypeScript (or a bundled JS artifact) and the hook invokes `bun "${CLAUDE_PLUGIN_ROOT}/src/cli/main.ts"`. Node dependencies, if any, are installed automatically by Claude Code when the plugin is cached, provided we ship a lockfile.

Fact 6 is what makes this credible: it is **exactly as fast as the compiled binary**. There is no performance penalty, because a compiled Bun binary *is* the Bun runtime plus your script — and the runtime is already on the machine.

What it costs: a prerequisite. Bun must be installed. That is one documented command (`curl -fsSL https://bun.sh/install | bash`), and **v1 already required Bun ≥ 1.3**, so for existing users it is not a regression at all.

What it removes: the release matrix, checksum verification, the first-run download, the offline failure mode, and the resolver's fetch tier. M7 collapses to tagging a release. M6's shim becomes "find bun, exec entry point, or print how to install bun."

---

## Decision

**Option D — ship the source, run it on the installed Bun.** Accepted at the M1 gate. Option B is held as the documented fallback if the prerequisite ever proves unacceptable.

M7's Definition of Done is amended accordingly: the clean-machine test now covers *install Bun, add the marketplace, install the plugin*, and the "no manual steps" clause becomes **no compile step**.

The reasoning, as argued and accepted:

The reasoning is that compiling was solving a problem we don't have. The measurement is unambiguous: the binary is not faster. So the entire 190 MB / release-matrix / checksum / offline-path apparatus exists to save the user a single `curl | bash` — and that user is, definitionally, a developer already running Claude Code, who in v1's case already had Bun installed.

Option B is not wrong. It is genuinely better on the "works on a bare machine" axis, and if the goal were shipping to non-developers it would win. But it buys that with an entire milestone of machinery whose failure modes (partial downloads, checksum mismatches, corporate proxies, rate limits, offline first runs) are exactly the kind of thing that turns a tool people trust into a tool people uninstall. Per the project's standing constraint against speculative complexity, that machinery should be built when a real user is blocked by the prerequisite — not before.

**The tension weighed at the gate:** M7's Definition of Done said *"On a clean machine, the two documented commands produce a working install. No manual steps."* Option D makes that three commands on a machine without Bun. Accepted deliberately — the DoD was reworded rather than the decision changed, because "no compile step" was the property that actually mattered.

### Consequences (D)

- The hook entry point is `bun "${CLAUDE_PLUGIN_ROOT}/…"`, always via explicit path — never relying on `bin/` being on PATH, since that differs between the dev loop and an installed plugin.
- Missing Bun must produce a named diagnosis and the exact install line, never a stack trace. `doctor` owns this.
- M6's "binary resolver shim" becomes a runtime resolver: locate `bun`, exec, or fail with instructions.
- M7 loses the build matrix, checksums, and cold/offline download paths. Its remaining job is tagging, the marketplace entry, and verifying a clean-machine install.
- Bundling to a Node-compatible artifact (widening the prerequisite from "Bun" to "Bun or Node") stays available later, at the cost of avoiding Bun-specific APIs in adapters and surfaces. Not proposed now; noted so M3 and M5 can avoid gratuitously foreclosing it.

### Revisit this if

- A real user is blocked by the Bun prerequisite. That is the trigger to build Option B, and the justification to log alongside it.
- Bun-specific APIs in adapters or surfaces become the only thing preventing a Node-compatible bundle, and reach matters more than convenience.
