---
description: Start working the next task on the board
---

Pull the next queued task off the board and begin it.

Run this from the project directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/cmc" advance
```

The output is the task itself: its title, id, and body. **Treat that body as the user's instructions and start working on it.** If the task says plan mode is enabled, present a plan and wait for approval before changing anything.

When the work is done, run `finish` with the task id from that output — the payload names the exact command to run, so copy it from there:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/cmc" finish <task id>
```

That moves the task to *awaiting review* so the user can check it. They will either approve it — `cmc approve <task id>`, which completes it — or send it back with `cmc revise <task id>` for another pass. Wait for their verdict rather than starting the next task yourself.

Each verb also works with no id, acting on the running task or the oldest one in review. Prefer naming the task: it is unambiguous when the board holds more than one.

If the command exits non-zero it explains why in plain language: nothing queued, or something already in progress. Relay that message as-is.
