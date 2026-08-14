# command-center — project instructions

## Naming — do not get this wrong

The project is called **command-center**. Full stop.

- Never "cc-command-center", never a "v2" suffix in the product name. Those are historical: v1 lived in a repo/state-dir named `cc-command-center`, and this rebuild was drafted as "v2". The name of the thing is just **command-center**.
- "v2" may appear only when explicitly contrasting with v1 (e.g. in the build log or changelog), never as part of the product's name, titles, package names, or UI strings.
- The CLI binary is `cmc` (as in v1 — `cc` collides with the system C compiler).

## Ground rules

- `PLAN.md` at the repo root is the build plan and entry point. Follow its execution protocol: one milestone at a time, stop at every 🚪 GATE, keep `.tracker/roadmap.json` updated continuously.
- v1 reference (read-only, never modify): `/Users/yeahitsmejayyy/Documents/Development/2026/_projects/cc-command-center`

## Design system

The UI's design system comes from **Claude design** — it is not invented ad hoc in this repo.

- When M8 (UI rebuild) starts, the design tokens, palette, type scale, and component direction come from a design system set up in Claude design. Do not improvise a visual language before that exists.
- `design-system-brief.md` at the repo root holds the answers used to set that up (the "Company name and blurb" and "Any other notes" fields, plus what to attach). It is **gitignored** — working material, not a deliverable.
- Keep it current. If the product's surfaces, palette, or tone change during the build, update the brief so a re-run of the setup produces the same system.
- M8's action item "establish real design tokens as a small explicit set" means *transcribe what Claude design produced*, not invent one.

## Commit messages

**End every turn that changed code with a commit message.** Not only when a
roadmap item is finished — any turn that leaves the working tree dirty ends with
a message Jayyy can copy and push. He should never have to ask for one.

If a turn changed nothing, say so instead of inventing a message.

- One line, short and concise. Imperative mood, lowercase, no trailing period.
- In its own ```bash fenced block so it's one click to copy.
- Prefix with the item's milestone id when it maps to one, e.g. `M1: verify plugin hook contract`.
- Jayyy commits and pushes himself. Never run `git commit`, and never add yourself as co-author.
