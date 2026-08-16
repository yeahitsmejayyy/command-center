# Plugin platform findings

*Research for M1-1 · verified against Claude Code **2.1.229** on macOS (darwin-arm64), 2026-08-12*

What the plugin system actually provides, established from the official reference docs **and** from inspecting a real installed plugin on this machine. Every claim is tagged:

- **[DOC]** — stated in the official docs
- **[VERIFIED]** — confirmed empirically on this machine
- **[UNDOCUMENTED]** — not stated; inferred or observed only

Sources: [plugins-reference](https://code.claude.com/docs/en/plugins-reference.md), [plugin-marketplaces](https://code.claude.com/docs/en/plugin-marketplaces.md), [hooks](https://code.claude.com/docs/en/hooks.md). Live specimen: `superpowers@superpowers-marketplace` v6.2.0.

---

## 1. `.claude-plugin/plugin.json`

**`name` is the only required field.** [DOC] Everything else is optional. Unrecognized top-level fields are ignored (warnings from `claude plugin validate`, not errors).

Metadata: `displayName`, `version`, `description`, `author` (`{name, email?, url?}`), `homepage`, `repository`, `license`, `keywords[]`, `metadata{}`, `defaultEnabled`.

`version` pins the plugin — users only get updates when it's bumped. Omitted, it falls back to the git SHA. [DOC]

Component-path fields (all relative to plugin root, `./`-prefixed): `skills`, `commands`, `agents`, `workflows`, `hooks`, `mcpServers`, `outputStyles`, `lspServers`, `experimental.themes`, `experimental.monitors`, `userConfig`, `channels`, `dependencies`.

Path semantics differ per field and this is a real trap: `skills` **adds to** the default `skills/` scan, while `commands`, `agents`, `workflows`, `outputStyles` **replace** their default directory entirely. `hooks`/`mcpServers`/`lspServers` merge. [DOC]

**Verified specimen** — superpowers ships exactly this, and nothing more: [VERIFIED]

```json
{
  "name": "superpowers",
  "description": "Core skills library for Claude Code: ...",
  "version": "6.2.0",
  "author": { "name": "Jesse Vincent", "email": "jesse@fsck.com" },
  "homepage": "https://github.com/obra/superpowers",
  "repository": "https://github.com/obra/superpowers",
  "license": "MIT",
  "keywords": ["skills", "tdd", "debugging"]
}
```

No component paths declared — it relies entirely on convention-based discovery.

## 2. `.claude-plugin/marketplace.json` — single-plugin repo

Required: `name`, `owner`, `plugins[]`. Each plugin entry requires `name` and `source`. [DOC]

For our case — one repo that *is* the plugin and also hosts its own marketplace — `source` is `"./"`, meaning the plugin is the marketplace root itself. Claude Code then looks for `.claude-plugin/plugin.json` and the component directories at that root. [DOC]

```json
{
  "name": "command-center",
  "owner": { "name": "Jayyy", "url": "https://github.com/yeahitsmejayyy" },
  "plugins": [
    {
      "name": "command-center",
      "source": "./",
      "description": "Per-project task queue companion for Claude Code",
      "version": "2.0.0",
      "license": "MIT"
    }
  ]
}
```

Other `source` forms available: `github` (`{repo, ref?, sha?}`), `url` (git), `git-subdir` (sparse checkout of a monorepo path), `npm` (`{package, version, registry?}`), `archive` (`{url, sha256?}`). [DOC] The `npm` and `archive` forms matter for ADR-001.

Relative `source` paths resolve from the **marketplace root** (the dir containing `.claude-plugin/`), not from inside `.claude-plugin/`. [DOC]

## 3. Directory layout

Component directories live at the **plugin root**, never inside `.claude-plugin/`. That directory holds only `plugin.json` (plus `marketplace.json` when the repo is also a marketplace). [DOC]

```
command-center/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── commands/          # flat .md files → /command-center:<name>
├── skills/            # <name>/SKILL.md
├── agents/
├── hooks/hooks.json   # auto-discovered
├── bin/               # executables — added to the Bash tool's PATH
├── scripts/
├── package.json + lockfile   # node deps auto-installed (see §7)
└── .mcp.json / .lsp.json
```

`commands/`, `skills/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json` are all auto-discovered by convention — no manifest declaration needed. [DOC] [VERIFIED — superpowers declares none and its skills/hooks load.]

Commands are namespaced by plugin name: `commands/enable.md` → `/command-center:enable`. [DOC]

## 4. Hooks

`hooks/hooks.json`, auto-discovered. Schema: [DOC]

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/bin/cmc\" hook session-start",
            "timeout": 30,
            "async": false
          }
        ]
      }
    ]
  }
}
```

Handler `type` may be `command`, `http`, `mcp_tool`, `prompt`, or `agent`. Command hooks take `command` (shell string or exec-form array), `args`, `timeout` (seconds, default **600**), `async`, `statusMessage`, `if`. [DOC]

**SessionStart matchers:** `startup`, `resume`, `clear`, `compact`, `fork`. [DOC] Note v1 used `startup|resume`; superpowers uses `startup|clear|compact`. [VERIFIED]

**SessionStart stdin JSON:** `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `source`. [DOC] — `cwd` is what we key project state on.

**Output contract.** Exit 0 with JSON on stdout injects context: [DOC]

```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "..." } }
```

Exit 2 blocks and shows stderr. Invalid JSON on exit 0 is ignored as a non-blocking error. Stderr is never parsed — keep diagnostics there, out of stdout. [DOC]

Both v1 and superpowers emit exactly the `hookSpecificOutput.additionalContext` shape. [VERIFIED] Our contract carries over unchanged.

**Timeout sharp edge:** `SessionEnd` hooks share a **1.5-second** budget unless a per-hook `timeout` raises it (max 60s). [DOC] v1 does cleanup on SessionEnd — it must be `async: true` or explicitly budgeted.

**Trust model:** plugin hooks run unsandboxed with no permission prompt once installed, and the user sees no explicit warning about bundled hooks at install time. [DOC] This is precisely why `SECURITY.md` (M9) is a real deliverable and not box-ticking.

## 5. Environment variables

| Variable | Resolves to |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | absolute path to the installed plugin directory |
| `${CLAUDE_PLUGIN_DATA}` | `~/.claude/plugins/data/{id}/` — **survives plugin updates** |
| `${CLAUDE_PROJECT_DIR}` | project root |

All three are exported to hook processes and MCP/LSP subprocesses, and substitute inline anywhere in hook and monitor commands, and anywhere in skill/agent markdown. [DOC] Confirmed working in a real hook command. [VERIFIED]

`${CLAUDE_PLUGIN_ROOT}` **changes on every plugin update** (cache dirs are per-version). Anything that must persist across updates belongs in `${CLAUDE_PLUGIN_DATA}`. [DOC] That makes `${CLAUDE_PLUGIN_DATA}` the natural home for a fetched binary cache.

## 6. Shipping executables

**`bin/` is a documented, first-class thing.** Verbatim: [DOC]

> Executables added to the Bash tool's `PATH`. Files here are invokable as bare commands in any Bash tool call while the plugin is enabled

Two distinct invocation paths, and the difference matters:
- **From Claude's Bash tool** — `bin/` is on PATH, so a bare `cmc …` works.
- **From a hook command** — PATH is *not* documented as including `bin/`; reference it explicitly as `"${CLAUDE_PLUGIN_ROOT}/bin/cmc"`. This is the form to rely on.

**The executable bit survives installation.** [VERIFIED] Undocumented, but confirmed: superpowers' `hooks/run-hook.cmd` and `hooks/session-start` are both `-rwxr-xr-x` in the cache, and the cached plugin is a real git clone (`origin → https://github.com/obra/superpowers.git`). Git preserves mode 755, so git-sourced plugins keep their exec bits. Not verified for `archive`/`npm` sources.

**There is no platform or architecture selection mechanism.** [DOC — by absence] Nothing in the docs selects `bin/cmc-darwin-arm64` over `bin/cmc-linux-x64`. A plugin that ships binaries ships *all* of them to *every* user, or resolves the right one itself at runtime.

The cost is concrete: **v1's compiled binary is 58 MB** (`bun build --compile`, Mach-O arm64). [VERIFIED] Three platforms is ~174 MB, git-cloned on install and again on every version bump, with each cached version kept in its own directory for ~14 days after being orphaned. That is disqualifying, and it is the central fact ADR-001 has to answer to.

**Path traversal is blocked:** an installed plugin cannot reference files outside its own directory; `../shared` does not survive the copy to cache. Symlinks pointing outside the marketplace are skipped for security. [DOC]

## 7. Node dependency auto-install — and the `--ignore-scripts` trap

When Claude Code caches a plugin, it installs the plugin's own Node dependencies, but **only** if the plugin root has both a `package.json` and a supported lockfile: [DOC]

| Lockfile | Command |
|---|---|
| `bun.lock` / `bun.lockb` | `bun install --frozen-lockfile --ignore-scripts` |
| `npm-shrinkwrap.json` / `package-lock.json` | `npm ci --ignore-scripts` |

`yarn.lock` and `pnpm-lock.yaml` are deliberately skipped. There's a 60-second timeout, and it cannot be disabled. [DOC]

**`--ignore-scripts` is the trap.** No `preinstall`/`install`/`postinstall` runs during this install. A plugin that ships a `package.json` whose `postinstall` fetches a binary gets *nothing* — silently, since a failed or skipped install never blocks the plugin.

**But there is an exception, and it's the whole ballgame for ADR-001:** [DOC]

> Fetching an npm-source plugin itself runs `npm install` with lifecycle scripts enabled, before this dependency install runs.

So a plugin distributed via `"source": {"source": "npm", ...}` **does** get its lifecycle scripts. Postinstall-fetch is viable — but only through an npm source, never through a git/GitHub source. Any ADR-001 option built on postinstall must also commit to npm as the distribution channel.

For anything the auto-install can't cover, the documented pattern is a `SessionStart` hook that installs into `${CLAUDE_PLUGIN_DATA}`, comparing the bundled manifest against a copy in the data dir to detect version drift. [DOC]

## 8. Installation & local development

```bash
claude plugin marketplace add <owner/repo | url | local-path>
claude plugin install <plugin>@<marketplace>          # --scope user|project|local
```

**Local development.** `--plugin-dir` is a **top-level `claude` flag, not a flag on `plugin install`** [VERIFIED — `claude plugin install --help` offers only `--config`, `--scope`, `--yes`]:

```bash
claude --plugin-dir /absolute/path/to/plugin     # loads for one session, repeatable
claude --plugin-url <url-to-zip>                 # session-only, from a zip
```

Also available: `claude plugin validate <path>` (with `--strict` for CI), `claude plugin init <name>` (scaffolds into `~/.claude/skills/<name>/`, auto-loading next session as `<name>@skills-dir`), `claude plugin details`, `claude plugin tag`. [VERIFIED]

A marketplace can be added from a local path, so the full marketplace→install path is testable without pushing to GitHub. [DOC]

## 9. Caching behavior

Marketplace plugins are **copied** to `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, one directory per version, rather than used in place. [DOC] [VERIFIED — matches `installed_plugins.json`, which records `installPath`, `version`, `installedAt`, and `gitCommitSha`.]

Orphaned versions are swept ~14 days after being replaced, so concurrent sessions on the old version keep working. A symlinked development checkout is never swept. [DOC]

---

## 10. Spike results (M1-2) — what actually happened

A throwaway `hello-cc` plugin was built and run end to end: a SessionStart hook, a namespaced command, and a real 63 MB `bun build --compile` binary in `bin/`. Everything below is **[VERIFIED]** on this machine.

**Everything the plan needed to confirm, confirmed:**

| Check | Result |
|---|---|
| SessionStart hook fires | Yes, `source=startup` |
| `additionalContext` reaches the session | Yes — `SPIKE-HOOK-OK` found in the transcript |
| Namespaced command appears | Yes — `/hello-cc:ping` returned `SPIKE-COMMAND-OK` |
| `${CLAUDE_PLUGIN_ROOT}` resolves in a hook command | Yes |
| Bundled binary keeps its exec bit and runs from a hook | Yes — `-rwxr-xr-x`, output `SPIKE-BINARY-OK` |
| Exec bit survives the copy into `~/.claude/plugins/cache/` | **Yes** — 63 MB binary intact at `-rwxr-xr-x` |

**Four things the docs got wrong or didn't say:**

1. **SessionStart's stdin JSON is smaller than documented.** Actual keys: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source`. No `prompt_id` and no `permission_mode` — don't depend on them.
2. **`bin/` on PATH is conditional — don't rely on it.** Inside the spike's hook, `command -v hello-bin` failed while the same binary ran fine via its full path. But dumping `$PATH` from that hook shows superpowers' own `bin/` directory *is* on it. So a marketplace-installed plugin's `bin/` does reach the hook's PATH, while a `--plugin-dir` inline load's does not. Since the dev loop and the installed path differ, **hooks must use `"${CLAUDE_PLUGIN_ROOT}/bin/cmc"` explicitly** rather than depending on PATH.
3. **A local-path marketplace install runs from the source directory, not the cache.** `CLAUDE_PLUGIN_ROOT` came back as the original path even though a full copy existed in the cache. Edits to a local checkout therefore take effect without reinstalling — the M6 dev loop is live-editable.
4. **`${CLAUDE_PLUGIN_DATA}` naming differs by install method:** `hello-cc-inline` under `--plugin-dir`, `hello-cc-hello-cc-marketplace` once installed from a marketplace. A binary cached during `--plugin-dir` development will **not** be found by the marketplace-installed copy. The resolver must tolerate a cold data dir.

**Runtime availability and startup cost** (measured for ADR-001):

- Both runtimes are on the hook process's PATH: `bun 1.3.14` at `~/.bun/bin/bun`, `node v22.12.0` at `/usr/local/bin/node`, plus `npx`. A hook can invoke either directly.
- **`bun run src/cli/main.ts list` is exactly as fast as the compiled binary** — 0.02s warm and 0.14s cold for both, measured against v1's real CLI over three runs each. Compiling to a standalone binary buys **zero** startup performance. Its only benefit is removing the runtime prerequisite.

**Operational notes for M6/M7:**

- `claude plugin validate <path>` validates **marketplace.json when both manifests are present** — it never even mentioned `plugin.json`. Our marketplace entry needs a `description` or `--strict` fails in CI.
- `claude plugin uninstall` requires a `--scope` matching the install scope, and removing the marketplace deregisters the plugin along with it.
- A one-line hello-world compiles to **63 MB** — the floor is the embedded Bun runtime, not our code. v1's full CLI is 58 MB. Size is structural and won't be optimized away.

---

## Consequences for this build

1. **The v1 hook contract survives intact.** Same events, same `hookSpecificOutput.additionalContext` output shape, same `cwd`-keyed project identity. M6 is genuinely a repackaging, not a redesign — but `SessionEnd`'s 1.5s budget needs `async: true`.
2. **Binaries in `bin/` work and keep their exec bit, but there is no platform selection** — and at 58 MB a copy, shipping all three is not viable. ADR-001 is really a choice between *resolve-at-runtime into `${CLAUDE_PLUGIN_DATA}`* and *npm-source distribution with lifecycle scripts*.
3. **`--ignore-scripts` eliminates postinstall for git-sourced plugins.** Any postinstall-based plan forces npm as the distribution channel. Decide both together or not at all.
4. **`${CLAUDE_PLUGIN_DATA}` is the right home for a resolved binary** — it survives updates, while `${CLAUDE_PLUGIN_ROOT}` changes every version.
5. **Hooks are unsandboxed and installed without a trust prompt.** `SECURITY.md` is load-bearing.
