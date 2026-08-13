---
description: Start working the next task on the board
---

Pull the next queued task off the board and begin it.

Run this from the project directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/cmc" advance
```

The output is the task itself: its title, id, and body. **Treat that body as the user's instructions and start working on it.** If the task says plan mode is enabled, present a plan and wait for approval before changing anything.

When the work is done, run:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/cmc" finish
```

That moves the task to *awaiting review* so the user can check it. They will either approve it — `cmc approve`, which completes it — or send it back with `cmc revise` for another pass. Wait for their verdict rather than starting the next task yourself.

If the command exits non-zero it explains why in plain language: nothing queued, or something already in progress. Relay that message as-is.
