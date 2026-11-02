# 006 — The agent that had no name

*2026-11-02*

The brief was a reasonable one. Several sub-agents, several tasks in flight, each agent working its own card: `Task.sessionId` was already there and already nullable, so the shape of the answer looked obvious. Stamp each task with the session that started it, and the board can tell its workers apart.

The field had been there since M2. Nothing had ever read it.

## The probe

Before building anything on top of it, it was worth checking what a sub-agent actually sees. So: spawn one, and have it print the environment variables that might carry an identity.

The first attempt used `${!v}` for indirect expansion, which is bash. This shell is zsh, which wants `${(P)v}` and says `bad substitution` otherwise. The second attempt used `${(P)v}` and was refused by a safety check that could not parse it — reasonably, since indirect expansion is exactly how you hide what a command is going to touch. The third attempt used `printenv` and worked, which is the lesson: if a tool cannot tell what your command does, that is information about the command.

The result:

| | Orchestrator | Sub-agent |
|---|---|---|
| `CLAUDE_CODE_SESSION_ID` | `abc…` | `abc…` — identical |
| `CLAUDE_PID` | `12345` | `12345` — identical |

Not similar. The same. A sub-agent's shell reports the orchestrator's pid as its own parent, because that is precisely what it is. There is no per-sub-agent identity to read, because from the outside there are no sub-agents — there is one session that happens to be thinking in parallel.

## What that costs

The whole design, as briefed. Not a detail of it.

If the board cannot tell two workers apart, then it cannot attribute a write to one of them, cannot lease a task to one, and cannot notice when one dies. A registry of agents would be a registry of indistinguishable rows. A heartbeat would be a heartbeat from the same process, answering for all of them. A lease would be held by everyone at once.

Every mechanism that sounded obvious depended on a fact that is not true.

## What replaced it

Nothing, which was the useful part.

The orchestrator already knows what it dispatched and whether it came back. That knowledge exists for free in the session that handed out the work, and no amount of bookkeeping on the board reconstructs it better. So the board stopped trying to model agents at all. Tasks became addressable instead — `cmc finish <id>` — and the thing that needed to be unambiguous became the *subject* of a verb rather than the *author* of it.

`--agent <label>` survives, but as a label the dispatcher chooses, for a human reading the board. It is explicitly not an identity, and it is commented as such in three places so that nobody rebuilds the registry on top of it in six months.

`sessionId` stays where it is: written, never read, now with a note saying why it cannot do the job it looks like it could do.

## The part worth keeping

The brief contained an assumption stated as a fact, and it took one command to find out. The cost of checking was a few minutes. The cost of not checking would have been a registry, a lease protocol, a heartbeat, and a stale-agent reaper — all of it correct-looking, all of it built on two environment variables that are the same string.

Shipping less than the brief asked for was the right outcome. [ADR-004](../decisions/004-parallel-work.md) records it as a decision rather than an omission, which is the only way a deliberate gap survives contact with a future reader.
