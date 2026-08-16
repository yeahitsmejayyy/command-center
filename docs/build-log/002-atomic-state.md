# 002 — Designing out the corruption window and the port race

*2026-08-12*

v1 had two known sharp edges, both documented, both worked around rather than fixed: a window where a crash could corrupt the queue file, and a roughly two-second race when allocating a port. Working around a race means retrying it. This entry is about deleting both.

There was also a third problem nobody had noticed.

## The bug that was hiding in plain sight

v1 keyed every project's state file by encoding the working directory:

```ts
cwd.replace(/\//g, "-").replace(/^-/, "")
```

So `/Users/j/dev/proj` becomes `Users-j-dev-proj`. Readable, obvious, and wrong: `/a/b` and `/a-b` both encode to `a-b`. Two unrelated projects would silently share one queue — no error, no warning, just tasks appearing in the wrong board.

It's the sort of bug that survives for years because the collision requires a directory name containing the separator character, which is rare enough to never happen to you and inevitable across enough users. It's now the first regression test in the adapter suite:

```ts
test("does not collide when a path contains the separator it encodes to", () => {
  expect(encodeCwd("/a/b")).not.toBe(encodeCwd("/a-b"));
});
```

The fix keeps the human-readable slug — you can still scan the state directory and recognise your projects — but identity comes from a hash of the full path appended to it. Readability for humans, uniqueness from mathematics, no tradeoff between them.

## The corruption window

v1 wrote state with a temp file and a rename, which is the right shape:

```ts
await writeFile(tmp, data);
await rename(tmp, path);
```

`rename(2)` within a filesystem is atomic, so a reader sees either the whole old file or the whole new one. What's missing is a flush. Without an `fsync` before the rename, the rename can land while the file's contents are still in the page cache. Under normal conditions nobody notices. After a power cut you get a correctly-named, zero-byte state file — your board, empty, with no indication anything went wrong.

The v2 write opens the temp file, writes, **syncs**, closes, then renames — and creates the temp file in the same directory as its target, because rename is only atomic within a single filesystem. A temp file in `/tmp` renamed onto a file in your home directory is a copy, not a rename, and copies are interruptible.

The test that matters here doesn't check the implementation; it checks the property. Hammer the file with writes and read it concurrently: every read must parse as valid JSON. Not "usually" — every time, because there is no moment when a partial file is visible under that name.

## Two protections that look redundant and aren't

v2 has both a lock and an optimistic version check, which invites the obvious question: if a lock serialises writers, what is the version for?

They guard different things. The lock stops two processes interleaving a read-modify-write on the same file. The version stops a caller acting on state it read *earlier* — a browser tab that's been open for ten minutes, a second terminal, a hook that read the board before you dragged a card. The lock protects the file; the version protects the user's intent. A stale write is rejected with both version numbers so the caller can re-read and retry, rather than silently clobbering someone else's work.

## The lock that a crash used to jam

v1's lock recorded the holder's pid, and checked staleness like this: if the lock file's mtime is older than ten seconds, *then* look at whether the pid is alive. The consequence is that a lock left behind by a crash blocks every subsequent run for the full timeout, and the documented remedy was deleting the file by hand.

The mtime is the wrong signal. What matters is whether the process holding the lock still exists — and that's knowable immediately, at any age, with `kill(pid, 0)`. v2 checks liveness first: a dead holder's lock is reclaimed on the spot. Garbage, empty, and truncated lock files are treated the same way, because an unreadable claim is as useless as a dead one.

One subtlety: file creation with `O_EXCL` is atomic *across processes*, but it can't serialise two async callers inside a single process — both would see the file they just created. Same-process waiters queue on a promise chain, and a test asserts that twelve overlapping critical sections never overlap.

## The race that no longer exists

This is the one I like. v1 allocated a port like this:

1. bind port `0`, letting the OS assign a free one
2. read the port number off the socket
3. **close the socket**
4. spawn a child process
5. child binds that port number

Between steps 3 and 5 the port belongs to nobody. Anything on the machine can take it, and then the child fails to bind. v1 handled this by waiting and retrying — a two-second window, documented as a known issue.

The window exists only because the port number is separated from the thing holding it. So v2 doesn't separate them: `bindLoopback()` binds `:0` and returns the **listening socket**, still open, alongside its port. The socket is never closed and re-opened. There is no interval during which the port is unheld, so there is nothing to lose and nothing to retry.

The test states the property directly — ask for a port, and it is already accepting connections:

```ts
const listener = await bindLoopback();
expect(await canConnect(listener.port)).toBe(true);
```

This is the difference between fixing a race and handling one. A retry loop says "this sometimes fails, so try again." Restructuring says "the failure mode is unreachable."

While writing the loopback-only test I got a reminder that a passing test can still be worthless: I first asserted that connecting to `0.0.0.0` fails. It succeeded — because connecting *to* `0.0.0.0` is remapped by the OS to loopback. The assertion proved nothing about what the socket was bound to. The real check is this machine's LAN address, which must refuse.

## Runtime records are claims, not facts

A record saying "pid 4821 is serving this project on port 61234" is a claim written by a process that may since have died. v2 verifies the pid on every read and deletes the record if the process is gone, so a stale record can't send a caller to a dead port. Same for a corrupt one: unreadable and dead are the same outcome, and both get reaped rather than thrown at the caller.

## What this cost

Four small modules and 47 tests. The tests are the point — every one of them names a specific failure mode that used to be possible: a collision, a truncated file, a jammed lock, a lost port, a stale record pointing at nothing.

None of this is clever. It's the ordinary work of taking each "known issue" from v1 and asking whether it needs to exist at all. Mostly they didn't.

Next: the CLI surface, where all of this gets driven by an actual human.
