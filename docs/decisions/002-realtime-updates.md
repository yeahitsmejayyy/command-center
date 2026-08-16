# ADR-002 — How the board stays current

**Status:** Accepted
**Date:** 2026-08-12
**Decides:** how the UI learns that state changed, replacing v1's 750 ms poll

---

## Context

v1's UI polled `GET /queue` every 750 ms and re-rendered on change. It worked, but every open tab re-read and re-parsed the entire board twice a second, forever, whether or not anything had happened.

The plan proposed SSE, with a cheap `GET /version` poll as the fallback if SSE proved complicated. Designing it surfaced a constraint that changes the shape of the answer.

**Mutations arrive from two directions.** The UI posts events over HTTP, so the server sees those directly. But Claude runs `cmc finish` in a *separate process* that writes the state file itself — the server never sees a request. A server that broadcast only what it did would leave the board silently stale precisely when the queue is moving, which is the one moment the board is worth looking at.

So the real question isn't "SSE or polling". It's **how the server detects a change it didn't make**, with the transport being a secondary decision.

## Options for change detection

### A — `fs.watch` on the state file

The obvious answer, and wrong here for two reasons.

Our writes are atomic: a temp file renamed over the target. That replaces the inode, and a watcher registered on the old file stops firing — the classic "my editor saved and the watcher died" problem, except we cause it deliberately on every write. Watching the containing directory works around it, at which point we're filtering directory events by filename.

On top of that, `fs.watch` semantics vary by platform: macOS coalesces via FSEvents, Linux uses inotify, and event delivery is documented as unreliable in exactly the edge cases we'd care about. A missed event means a permanently stale board with no self-correction.

### B — Server-side change detection, one `stat()` on an interval — **chosen**

The server polls a single `stat()` of the state file every 400 ms and compares `mtime:size`. On change it reads the state once and pushes to every connected client.

The important property: **the poll is server-side and shared**. v1's cost scaled with open tabs — each one independently fetching and parsing the whole board. Here the cost is one `stat` per interval regardless of how many clients are watching, and a full read only when something actually changed. It is strictly cheaper than v1 at one tab and dramatically cheaper at three.

It is also boring, which is the point: no platform-specific behaviour, no inode invalidation, no missed-event failure mode. If a change is somehow missed, the next tick catches it — the mechanism is self-correcting by construction.

## Transport: SSE

With detection solved, SSE is the easy half. It's a plain HTTP response that stays open, needs no protocol negotiation, and `EventSource` reconnects on its own — meaning a server restart heals without any client-side retry logic. Each connection is sent the current state immediately on connect, so there is no "empty until the first change" gap.

WebSockets were never justified: nothing flows upstream over this channel. Mutations are ordinary `POST`s.

`GET /api/version` still exists as the cheap probe — used by `doctor`, useful for scripting, and available as a fallback if a client can't hold a stream open.

## Decision

**Server-side `stat` polling for detection; SSE for delivery; `GET /api/version` retained as a cheap probe.**

Latency is bounded at ~400 ms from any source — the UI, the CLI, or Claude — which is faster than v1's 750 ms poll while doing far less work.

## Consequences

- Anything that writes state is picked up, regardless of which process wrote it. The CLI needs no knowledge that a server exists.
- The 400 ms interval is the tuning knob. Lower costs more `stat` calls; higher adds latency. It is not exposed as configuration until someone has an actual reason to change it.
- `mtime:size` can theoretically miss a change that preserves both within one tick. Our writes always change the version integer, so size is stable only if the payload is byte-identical — in which case there is nothing to push.
- A dead SSE client is dropped when a write to it fails, so the client set can't grow without bound.

## The bug this decision produced

Worth recording, because it was caught by exactly the test that mattered.

The first watcher implementation used `null` for "no state file yet" *and* as the "nothing observed yet" sentinel. On a fresh project there is no state file, so when the first task was created the watcher treated the file appearing as *establishing its baseline* rather than as a change — and never pushed. Every subsequent change worked fine, which is the worst kind of bug: invisible in casual use, guaranteed to hit every new user on their very first task.

The fix separates the two meanings with an `established` flag, so "absent" becomes a real observed value that can be compared against. The test that caught it is the one that spawns the CLI as a genuinely separate process and waits for a push — a test that had mocked the CLI, or made the change in-process, would have passed while shipping the bug.
