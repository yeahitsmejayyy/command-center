---
description: Turn on the command-center task board for this project
---

Enable command-center for the current project.

Run this from the project directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/cmc" enable
```

The command prints the board's URL. Report it to the user and tell them the board is open in their browser. From here on, this project's board starts automatically at the beginning of every session.

If it reports a problem, run `cmc doctor` and relay the named fix — do not guess at a cause.
