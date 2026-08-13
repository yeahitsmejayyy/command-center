---
description: Leave this project alone — no task board, no prompts
---

Turn command-center off for the current project.

Run this from the project directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/hooks/run" skip --contract 1
```

Confirm to the user that this project is now skipped: no board will start, and they will not be asked again. Mention that `/command-center:enable` reverses it whenever they want.
