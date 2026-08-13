# command-center — project instructions

## Naming — do not get this wrong

The project is called **command-center**. Full stop.

- Never "cc-command-center", never a "v2" suffix in the product name. Those are historical: v1 lived in a repo/state-dir named `cc-command-center`, and this rebuild was drafted as "v2". The name of the thing is just **command-center**.
- "v2" may appear only when explicitly contrasting with v1 (e.g. in the build log or changelog), never as part of the product's name, titles, package names, or UI strings.
- The CLI binary is `cmc` (as in v1 — `cc` collides with the system C compiler).

## Ground rules

- `PLAN.md` at the repo root is the build plan and entry point. Follow its execution protocol: one milestone at a time, stop at every 🚪 GATE, keep `.tracker/roadmap.json` updated continuously.
- v1 reference (read-only, never modify): `/Users/yeahitsmejayyy/Documents/Development/2026/_projects/cc-command-center`

## Commit messages

Every time a roadmap/tracker item is finished, hand Jayyy a commit message for it — no waiting for the end of the milestone.

- One line, short and concise. Imperative mood, lowercase, no trailing period.
- In its own ```bash fenced block so it's one click to copy.
- Prefix with the item's milestone id when it maps to one, e.g. `M1: verify plugin hook contract`.
- Jayyy commits and pushes himself. Never run `git commit`, and never add yourself as co-author.
