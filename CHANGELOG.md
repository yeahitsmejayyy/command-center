# Changelog

## 2.1.0

### Changed

- **The instructions open the editor when you click them.** They are the thing you come to a task to change, so the text itself is the control. Copying still copies — the copy button sits outside the clickable area.
- **Closing an edit with unsaved changes asks first.** All four ways out — Escape, the close button, clicking outside, and Cancel — now warn rather than discarding silently. Answering "Discard" from the close button closes the dialog; from Cancel it returns you to the task. Whitespace alone is not treated as a change, so the warning only appears when something real would be lost.

## 2.0.0

A rebuild. Everything v1 proved is intact — local-first, JSON files under a lock, no database, no daemon, the same task lifecycle. What changed is the seams around it.

### Installing

- **Two commands instead of six.** `/plugin marketplace add` and `/plugin install`. No clone, no `bun install` ×2, no compile, no symlink.
- **No binary.** v1 had you build a 58 MB executable. It turned out to be exactly as fast to run the source on the Bun you already have — a compiled Bun binary is the runtime plus your script. The build matrix, checksums, and first-run download all disappeared with it.
- **`~/.claude/settings.json` is never touched.** Hooks are declared in the plugin manifest. v1 merged entries into your settings file; uninstalling meant editing it back by hand.
- **Slash commands are namespaced** — `/command-center:enable`, `:skip`, `:start` — and ship with the plugin instead of being copied into `~/.claude/commands/`.

### Fixed

- **Two projects could share one board.** v1 keyed state by replacing `/` with `-` in the path, so `/a/b` and `/a-b` produced the same key. Silent, and it put tasks on the wrong board.
- **Symlinked project paths** now resolve to one identity. On macOS `/var` is a symlink to `/private/var`, so the CLI and the hook could disagree about which project they were in — enable the board in one, and the other reported the project untouched.
- **The port allocation race is gone.** v1 bound a port, closed it, then handed the number to a child process to re-bind — a documented ~2 second window where anything could take it. The server now binds its own port and reports it off the live socket, so the window does not exist.
- **A crash mid-write can no longer empty your board.** Writes are flushed before the rename; without that, a power cut could leave a correctly-named zero-byte state file.
- **A stale lock no longer blocks you.** v1 decided staleness by file age and documented deleting the lock by hand. It is now decided by whether the holding process is alive, so a crashed run's lock is reclaimed immediately.
- **Concurrent writers cannot lose an update.** The whole read-modify-write runs inside the lock.

### Changed

- **The board pushes instead of polling.** v1 polled every 750 ms from every open tab. Updates now arrive over SSE, detected by one shared server-side check — so changes Claude makes in its own process show up without the board asking.
- **Only one task can be in progress**, and a second one is refused with a message naming the task that is blocking it. v1 silently demoted the running task.
- **Backlog and Queue are the only columns you can drag into.** In Progress, In Review and Done are records of what the workflow did; a card dropped there would claim something that never happened. Use `advance`, `finish`, and `approve`.
- **`cmc doctor`** is new: every known failure has a named diagnosis and a command that fixes it.
- **`cmc add`** is new, so the whole lifecycle can be driven from a terminal.
- **State moved** from `~/.cc-command-center/` to `~/.command-center/`.

### Removed

- `cmc install` and `cmc uninstall`. There is nothing to install into any more.

---

## Migrating from v1

v2 installs alongside v1 and does not read v1's state, so nothing is destroyed by trying it. Two things are worth cleaning up.

**1. Remove v1's hook entries from `~/.claude/settings.json`.** v1 wrote them; v2 will not remove them, and they will keep pointing at v1's binary. Open the file and delete the `SessionStart`, `SessionEnd`, and `Stop` entries whose commands mention `cc-command-center` or `cmc`:

```bash
# See what is there first
grep -n "cmc\|cc-command-center" ~/.claude/settings.json
```

If v1 is still installed, `cmc uninstall` removes them for you — do that before removing v1.

**2. Old state is not migrated.** v1's boards live in `~/.cc-command-center/`, v2's in `~/.command-center/`. Boards are per project and usually short-lived, so the intended path is to start fresh. If a v1 board matters, the task list is readable JSON and can be re-entered by hand, or scripted with `cmc add`:

```bash
# v1's board for a project, as JSON
cat ~/.cc-command-center/queues/<encoded-project>.json
```

Once v2 is working, `~/.cc-command-center/` can be deleted.

**3. Remove v1's slash commands** if you copied them: `~/.claude/commands/CCCommandCenter-enable.md`, `CCCommandCenter-skip.md`, `queue-start.md`. v2 ships its own, namespaced.
