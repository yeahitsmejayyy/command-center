# Security

command-center is a Claude Code plugin, which means it runs code on your machine with your credentials, without a permission prompt, every time a session starts. You are right to want to know what it does before you install it.

This document is meant to be checkable. Every claim below can be verified against the source, and the commands to do so are included.

---

## The short version

- It runs **only while a Claude Code session is open** for a project you have explicitly enabled. There is no daemon and nothing starts at boot.
- It reads and writes **one directory**: `~/.command-center/`.
- It listens on **loopback only** (`127.0.0.1`), on a port the operating system assigns.
- It makes **no outbound network requests**. None. After install it works with the network off.
- It **never reads or writes `~/.claude/settings.json`**, or anything else in `~/.claude/`.
- It does not read your source code, your environment, your credentials, or your git history.

---

## What runs, and when

| Trigger | What happens |
|---|---|
| A session starts in an **enabled** project | The hook starts a board server for that project if one is not already running, and tells Claude the board's URL |
| A session starts in an **undecided** project | The hook offers `/command-center:enable` or `/command-center:skip`, and starts nothing |
| A session starts in a **skipped** project | Nothing at all. No output, no process |
| The **last** session for a project ends | That project's board server stops |
| You run `cmc …` yourself | Only that command runs |

A project is untouched until you enable it. Skipping is permanent until you change it.

## What it executes

One thing: **Bun**, running this plugin's own TypeScript.

The single entry point is `bin/cmc`, a shell script short enough to read in one sitting. It locates Bun on your `PATH` (or in the usual install locations) and `exec`s it. It does not download anything, does not run an installer, and does not evaluate anything it did not ship with.

```bash
cat bin/cmc          # the entire executable surface
cat hooks/hooks.json # every event it hooks, and the exact command each runs
```

There is **no compiled binary**. The plugin ships source, which means what you audit is what runs: every file that executes is plain TypeScript in `src/`, readable in the repository you installed from. That was a deliberate trade, and the reasoning is written down in [ADR-001](docs/decisions/001-binary-distribution.md).

## What it reads

- `~/.command-center/**` — its own state.
- Files **you** attach to a task, at the moment you attach them, in order to copy them into its own directory.
- Its own `node_modules/zod/package.json`, so `cmc doctor` can report the dependency version.
- Its own built UI files, to serve them to your browser.

It does **not** read the files in your project. The project directory is used only as an identifier: the path is hashed to key that project's state. Nothing under it is opened.

## What it writes

Everything lives under `~/.command-center/` (override with `COMMAND_CENTER_HOME`):

| Path | Contents |
|---|---|
| `state/` | Your board — tasks, titles, and the instructions you wrote |
| `runtime/` | Which process serves which project, on which port |
| `locks/` | Advisory lock files, so two writers cannot corrupt a board |
| `logs/` | Per-project server logs, one JSON object per line |
| `preferences/` | Whether each project is enabled or skipped |
| `attachments/` | Copies of files you attached to tasks |

Nothing is written anywhere else. No dotfiles in your project, no shell profile edits, no launch agents.

```bash
ls -R ~/.command-center     # everything it has ever stored
```

## What it sends

Nothing.

There is no telemetry, no analytics, no crash reporting, no update check, and no phone-home. The only URL in the source is a `https://bun.sh/install` string printed in an error message when Bun is missing — text, never fetched.

The server binds `127.0.0.1` explicitly, so it is not reachable from your network. Both facts are enforced by tests:

```bash
bun test src/surfaces/server   # asserts a LAN address cannot reach it
bun test src/surfaces          # asserts no source file makes an outbound request
```

## What it deliberately does not do

**It never touches `~/.claude/settings.json`.** v1 merged hook entries into that file — the file that decides what executes in your Claude sessions. That was the single best reason to be wary of installing it. v2 declares its hooks in the plugin manifest instead, so the capability is gone rather than merely unused.

---

## Things you should know, not reassurances

**Plugin hooks are unsandboxed and ungated.** This is how Claude Code works, not something this plugin chose. Once installed, hooks run with your user's full permissions and no per-run approval. That applies to every plugin you install, and it is why reading `bin/cmc` and `hooks/hooks.json` before installing is worth the two minutes.

**The board has no authentication.** Anything that can reach `127.0.0.1` on the server's port can read and modify that project's board. That means any process running as you, and anyone with access to your unlocked machine. It is not exposed to your network, but it is not a secret from your own machine either.

**Task instructions are stored in plain text**, and are handed to Claude verbatim when a task starts. Do not put credentials in a task body. Attachments are copied as-is, with no encryption — treat `~/.command-center/attachments/` as visible as any other directory in your home folder.

**Attachments are copied, not linked.** Deleting a task deletes its copies, but a file you attached and later deleted from your project still exists there until the task is removed.

**Enabling a project is a standing decision.** Once enabled, every future session in that directory starts a board without asking again. `cmc skip` reverses it.

---

## Auditing it yourself

```bash
cat bin/cmc                                   # the only executable
cat hooks/hooks.json                          # every hook, and its exact command
grep -rn "fetch(" src/                        # outbound requests (there are none)
grep -rn "homedir()" src/                     # everywhere it resolves a path
ls -R ~/.command-center                       # everything it has stored
cmc doctor                                    # what it thinks its own state is
```

The code is organised so this surface stays small: `src/core/` is pure logic with no I/O at all, `src/adapters/` holds everything that touches the disk or the network, and `src/surfaces/` is the CLI, the hook, and the server. If you want to know what reaches your filesystem, `src/adapters/` is the whole answer. The boundaries are described in full, and enforced by a test that greps the real imports, in [docs/architecture.md](docs/architecture.md).

## Reporting a problem

Open an issue at <https://github.com/yeahitsmejayyy/command-center/issues>. If it is a vulnerability rather than a bug, say so in the title and leave out the details until we have somewhere private to discuss them.
