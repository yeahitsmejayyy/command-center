# ADR-004 — Tasks are addressable; agents are not modelled

**Status:** Proposed
**Date:** 2026-11-01
**Decides:** how several sub-agents work the board at once — what identifies the worker, which verb names which task, and what the board refuses to know

---

## Context

One human, many sub-agents. The orchestrating Claude session fans sub-agents out across several queued tasks so a board can be worked in parallel. Local-first is unchanged: one state file, one lock, one machine, no database, no new daemon, no auth, no network.

Today the board runs exactly one task. That is not a guard bolted onto the domain — it *is* the domain:

- `activeTask(state)` in `src/core/types.ts` is `tasks.find(t => t.status === "in-progress")`. Singular by definition.
- `finish`, `approve`, and `revise` carry **no task id** in `EventSchema`. They act on whatever that `find` returns.
- `applyAdvance` rejects a second start with `E_ALREADY_ACTIVE`: *"Finish it before starting another."*
- `applyRevise` additionally refuses whenever anything is in progress.

So the question is not "how do we allow two cards in a column" — it is "what is the subject of a lifecycle verb, once there is more than one candidate."

### What the investigation found

**A sub-agent is not a session.** This was worth checking rather than assuming, and the assumption in the original brief was wrong. A probe sub-agent reported:

| Variable | Orchestrator | Sub-agent |
| --- | --- | --- |
| `CLAUDE_CODE_SESSION_ID` | `c74ff65c-…` | `c74ff65c-…` *(identical)* |
| `CLAUDE_PID` | `54504` | `54504` *(identical)* |
| shell `PPID` | — | `54504` |

A sub-agent shares the orchestrator's session id and runs under the same parent process. **The platform offers no per-sub-agent identity.** `Task.sessionId` distinguishes separate Claude *windows*, not agents within one.

**`Task.sessionId` is dead weight today.** `advance` accepts `--session`, but `/command-center:start` never passes it. Every task on a live board carries `sessionId: null`. The field the brief called "the seed of per-agent ownership" has never been populated.

**The lock is already correct.** `withLock` acquires by `O_EXCL`, reclaims on holder liveness rather than file age, and chains same-process waiters on a promise queue. N sub-agents each running `cmc finish` as separate processes serialise properly today. Nothing in the storage layer needs to change — a genuinely pleasant finding, and it means this is a domain-logic change only.

**`approve` is already plural-tolerant.** It takes `oldestAwaitingReview(state)`, a queue discipline, not a single-active assumption. The review side is half-built for this already.

**The UI needs almost nothing.** Columns already render N cards. The only structural claim is `accepts: false` on In Progress, which stays correct, plus one line of empty-state copy that becomes a lie.

## Decision

**Lifecycle verbs take an optional task id. Agents are not modelled at all.**

Three parts:

**1. The subject of a verb is a task id, supplied by the caller.**
`finish`, `approve`, and `revise` gain an optional `id`. Omitted, each behaves exactly as it does now — sole in-progress task, oldest awaiting review. Supplied, it names that task. Backward compatibility is structural, not a flag: the single-agent loop emits events with no `id` and takes the identical path.

**2. The orchestrator is the only thing that writes to the board.**
It calls `advance` once per agent, receives a task, and hands that agent its body. When the agent reports back, the orchestrator calls `finish <id>`. Sub-agents never touch the CLI.

This is a deliberate narrowing of an earlier draft, in which each agent ran `cmc finish <id>` as its last step. The lock makes that safe, so the objection is not concurrency — it is that an agent would decide when its own work was done. A confused agent can finish a task it never did, and a crashed one leaves nothing behind. With the orchestrator holding the pen, a dead agent leaves its task visibly in progress, which is the truth.

No registry, no lease, no heartbeat, no identity — the only component that needs to know which agent holds which task is the one that did the handing out, and it is also the only one allowed to act on it.

**3. Concurrency is a per-project preference, default 1.**
`E_ALREADY_ACTIVE` stops being an absolute refusal and becomes a limit check. At the default of 1 the message and behaviour are byte-identical to today. Raising it is how a user opts into parallelism.

### These ship in that order, and the order matters

Decision 1 lands first and alone, as **M10**. Decisions 2 and 3 are **M11**, deferred until a workload needs them.

Addressability is not scaffolding for parallelism — it fixes a defect that exists at concurrency 1. With two tasks awaiting review, `cmc approve` silently takes the oldest and the user cannot tell what they approved. That is live today, with no sub-agents anywhere near it.

The case for *not* immediately building the rest came from reading the actual backlog. Of six items, three are decisions that need the human rather than an agent (*"needs a decision, not code"* is a task body, verbatim), and the two build-log tasks collide on the same narrative index. Agents in front of a serial review gate relocate the queue; they do not shorten it. The gate was kept on purpose, so the gate is the constraint, and parallelism pays only when there is a batch of genuinely independent mechanical work to feed it.

Banking the design and declining to build it yet is the cheap half of this decision. Nothing in M10 is wasted if M11 never happens.

### What the board refuses to know: file collisions

**Out of scope, deliberately, and stated in the docs rather than left unsaid.**

Two agents editing the same file is where parallel work actually breaks, and the board cannot help. It has no model of what a task touches, and acquiring one means per-task file globs that are stale the moment a task's scope shifts — the exact machinery this project exists to avoid. A queue that *advertised* collision safety it could not deliver would be worse than one that says plainly it has none.

The mitigations are the orchestrator's: dispatch non-overlapping tasks, or give each agent its own git worktree. Both belong in the docs. Neither belongs in core.

## Options weighed

**A. Mint an agent id and track ownership in state.** A `claim` event, an agent registry, a lease with a timeout so a crashed agent's task returns to the queue. Rejected: the platform gives no agent identity to anchor it to, so the id would be invented by the orchestrator and threaded through every call anyway — all the plumbing of ownership with none of the authority. The lease timeout is the real cost: it is a scheduler, and a scheduler needs to know what "stuck" means. The orchestrator already knows, because it is waiting on the sub-agent.

**B. Each sub-agent calls `advance` itself.** Appealing — agents pull work instead of being handed it. Rejected: the lock serialises the calls correctly, but a sub-agent's report back to the orchestrator is prose, so the orchestrator learns which task an agent took only by reading it. Dispatch becomes unobservable at exactly the moment there are several of them. Pull also makes a concurrency limit the only brake on an agent that loops.

**C. Status-per-agent columns.** Model parallelism in the board shape — a lane per agent. Rejected: it hard-codes a worker count into the schema, and `skipped` already demonstrates the project's preference for statuses that are states rather than places.

**D. Reuse `sessionId` as the agent key.** Rejected on evidence: sub-agents share one session id, so it cannot discriminate. Keeping the field is still right for forward compatibility with several Claude windows on one project, which `attachSession` already supports.

## Consequences

- **The review gate becomes the bottleneck, visibly.** This is the intended trade — agents parallelise work, not judgement — but it has an edge the single-task loop never had: with three tasks in review, a bare `cmc approve` silently picks the oldest. The user cannot tell what they just approved without reading the output. `approve <id>` is therefore not a nicety; it is what makes a multi-task review gate honest, and the board UI becomes the primary review surface rather than the terminal.
- **`attempts` and `startedAt` already differentiate cards.** For a human-readable label, `advance --agent <label>` stores a caller-chosen string (`reviewer`, `docs`) on the task. It is a label the orchestrator picked, never platform identity, and the distinction is worth keeping in the naming so nobody later mistakes it for a trustworthy id.
- **A task can now be finished by an agent that did not start it,** because nothing verifies the claim. Accepted: the board is a queue, not an access-control system, and everything touching it runs as the same user on one machine.
- **The hook's announcement needs a plural voice.** `if (active)` reads as *"X is currently in progress. Run `cmc finish`…"* — advice that misleads the moment two things are running.
- **`events.jsonl` stays deferred.** Parallel work is the strongest argument yet for an audit log, and it still does not meet the bar set in the standing constraints: a real bug that the log would have caught. Revisit if one appears.

## What this does not foreclose

A shared board across machines stays possible and stays unbuilt. Nothing here assumes a single writer — the lock is already cross-process — and `sessionId` plus `attachSession` survive as the place multi-window identity would live. The thing that would have foreclosed it is modelling agents as first-class state; declining to do that is what keeps the door open.
