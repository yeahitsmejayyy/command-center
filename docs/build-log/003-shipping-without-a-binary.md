# 003 — Shipping without a binary

*2026-08-13*

[ADR-001](../decisions/001-binary-distribution.md) deleted most of this milestone before it started. There is no compiled binary, so there is no cross-platform build matrix, no checksum verification, no first-run download, and no offline-download failure path. What was going to be a distribution pipeline became a tag and some verification.

Which left room to find the thing that actually threatens this design.

## The dependency is the new binary

Shipping source means the code has to *resolve* on someone else's machine. command-center has exactly one runtime dependency — zod — and Claude Code installs it when it caches the plugin. The documentation is unusually candid about what happens when that fails:

> A failed or skipped install never blocks the plugin.

Silently. So I went looking for what a user actually gets when it doesn't complete, by copying the plugin exactly as a git-source install would deliver it — no `node_modules` — and running it.

It worked. Which was the wrong answer, and it took two more attempts to find out why.

**First false negative:** zod resolved from `/Users/me/node_modules`. Node-style resolution walks *up* the directory tree, and there was a stray `node_modules` sitting in my home directory. Any test run anywhere under `$HOME` would have inherited it. The test wasn't proving the plugin worked; it was proving my home directory was messy.

**Second false negative:** moving the copy outside `$HOME` produced a more interesting result — it still worked, resolving zod from `~/.bun/install/cache/zod@4.4.3`. Bun's auto-install had quietly fetched a dependency at runtime. Note the version: **4.4.3**, against a `^3.24.1` pin. A different major version, resolved silently, running the state machine.

That is a worse failure than a crash. A missing module is a clean error someone can act on. A different major version of your validation library, loaded without comment, is a bug report six months later that nobody can reproduce.

The real behaviour, once isolated properly:

| Situation | What happens |
|---|---|
| Dependency installed (the normal path) | Correct pinned version, works offline forever |
| Install failed, network available | Bun auto-installs **whatever version it can reach** |
| Install failed, no network | `error: Cannot find package 'zod'` |

## Making the invisible visible

`doctor` gained a `dependencies` check, and getting it right took two tries — the first version was itself a false negative.

The obvious implementation reads `node_modules/zod/package.json` for the version. But in exactly the broken case there *is* no local copy: it came from Bun's global cache. The check reported "zod is installed" and passed, on the precise scenario it was written to catch.

The signal that actually works is **where the module resolved from**:

```
! dependencies: zod is being auto-resolved from ~/.bun/install/cache/zod@3.25.76/index.js
  rather than the plugin's own node_modules, so its version is whatever Bun had to
  hand — not the pinned 3.x. The plugin's dependency install did not complete.
    fix: bun install --cwd "/path/to/plugin"
```

"It loaded" is not the same as "the right one loaded." A health check that can't tell those apart is decoration.

## What a release is now

No artifacts, so the manifests *are* the build output — and there are three places a version can disagree: `plugin.json`, the marketplace entry, and the git tag. A marketplace entry pinning a version the plugin manifest contradicts installs perfectly and serves the wrong thing.

`scripts/check-manifests.ts` refuses that, and also checks something less obvious: that the `--contract` version in `hooks.json` matches the constant the code compiles against. Those two are the plugin's internal handshake, and they live in different files with nothing but discipline holding them together. Now CI holds them together instead.

It deliberately does not depend on the `claude` CLI being installed in a runner — a release check that only runs where the tool is already installed isn't much of a check.

## What was verified, and how

Not by reasoning about it:

- **Cold install** — the plugin copied exactly as a git source delivers it, `bun install --frozen-lockfile --ignore-scripts` run the way Claude Code runs it, then the full add → advance → finish loop. Works.
- **Offline after install** — the same install with an unreachable registry (`BUN_CONFIG_REGISTRY=http://127.0.0.1:1`) and an empty Bun cache. Still works, because nothing is fetched at runtime. That is ADR-001's promise, tested rather than asserted.
- **Missing Bun** — run with `PATH=/usr/bin:/bin` and no `~/.bun`, in both modes. CLI exits non-zero with the install command on stderr; the hook exits 0 and explains itself inside the session. Eleven tests now hold that behaviour in place, where before it was something I'd checked once by hand.

There is also a test asserting the plugin declares exactly **one** runtime dependency. Not a style rule — every dependency is another thing that must install correctly on a stranger's machine before any of this works, and the count should be a decision rather than an accident.

## The honest remaining risk

The whole class of problem above exists because we ship source with a dependency. Zero dependencies would delete it: no install step, nothing to resolve, nothing to drift, nothing to fail silently. zod is used in three files, and replacing it with hand-written validation is a real but bounded piece of work.

That is a live question rather than a settled one, and it deserves an ADR rather than a paragraph here. For now the risk is named, detected, and given a one-line fix — which is the difference between a known limitation and a trap.

Next: the UI, and the first part of this rebuild anyone will actually look at.
