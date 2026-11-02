# 005 — Eight commits of green tests and red CI

*2026-08-19*

For eight commits I reported that the suite passed. It did. I ran `bun test`, watched it come back green, wrote that down, and moved on. CI was red for every one of those commits, and the two facts never met, because I never had cause to look at a thing I already believed I knew.

That is the whole entry, really. The bug underneath it is three lines of YAML. The habit underneath it took longer to notice.

## Two manifests, one test runner

The UI keeps its own `package.json`. That was deliberate: the board ships prebuilt, so nobody installing the plugin should have to download Vite and React and a TypeScript compiler to use a task tracker. Build dependencies live under `ui/`, runtime dependencies live at the root, and a user only ever resolves the root set.

`bun test` does not know about that boundary. It sweeps the whole repo, finds every `*.test.ts` under it, and runs them — including `ui/src/lib/draft.test.ts`, `ui/src/lib/placement.test.ts`, and the rest of the board's tests, which import from `ui/node_modules`.

CI ran `bun install --frozen-lockfile` at the root. Only at the root. So the runner had the runtime dependency and nothing else, and then ran a test command that reached into a directory where nothing had ever been installed.

The failure reads like a missing module, which is the misleading part. The modules were not missing. They were never installed, in a tree the runner had no reason to populate, by a test command that had every reason to look there. Locally I had run `bun install --cwd ui` months earlier to get the UI building at all, and never thought about it again — which is precisely why I couldn't see it.

## What the green suite was actually evidence of

**The false confidence:** "the suite passes" is a claim about a machine. I had been treating it as a claim about the code.

Locally, `bun test` passes because my working tree has `ui/node_modules` in it — an artifact of my own setup, not of anything committed. The repo does not contain it and should not. So the local run and the CI run were exercising genuinely different programs, and the only one that matched what a fresh clone produces was the one I wasn't reading.

Eight commits is the number that bothers me. Not because the fix was hard, but because nothing in my loop was built to surface the disagreement. I wrote progress reports from the terminal I was already looking at. CI reported to a tab I had no reason to open, because the code was fine — I'd just tested it.

A green suite on a machine where you have already fixed the environment by hand is not evidence. It is a memory of having fixed it.

## The fix, and the thing the fix exposed

Installing the UI dependencies in CI is one step:

```yaml
- name: Install UI build dependencies
  run: bun install --frozen-lockfile --cwd ui
```

Which raised an adjacent question with the same shape. If CI is now installing the UI toolchain, it can also *build* the UI — and if it can build it, it can check whether the bundle committed to `ui/dist` still matches the source that produced it.

That matters more than it looks. Claude Code installs plugins with `--ignore-scripts`, so Vite never runs on a user's machine; whatever is in `ui/dist` at tag time is the board they get, forever. A stale bundle is not a build failure. It is a board that silently does not match its own source, and every test in the repo passes while it happens.

So CI builds the UI and diffs the result against what is committed:

```
::error::ui/dist is stale. Run 'bun run --cwd ui build' and commit the result.
```

Both of these are the same move: take something that was holding together because I remembered to do it, and make a machine that doesn't remember anything check it instead.

## The sequel, which is the actual lesson

`ci.yml` was fixed. `release.yml` was not.

The two workflows do nearly the same work — install, typecheck, test, check manifests, verify the entry point — and they are two files. The UI install and the bundle check went into one of them. Some weeks later I tagged `v2.1.1` and watched the release run go red on exactly the failure I had already fixed, in exactly the same way, because the release workflow had quietly fallen behind the one every pull request passes.

The version number is spent. You cannot re-tag `v2.1.1` and pretend the first one didn't happen, so the gate cost a release to discover.

Two things came out of that. The release workflow's checks are now a deliberate superset of CI's, written down in a comment in the file so the next person to add a step to `ci.yml` is told where else it belongs:

> This workflow's checks must stay a superset of `ci.yml`'s, or the release gate is weaker than the gate every pull request already passes.

And `release.yml` gained a `workflow_dispatch` trigger, so the gate can be run on demand. A gate you can only exercise by tagging is a gate you first exercise during a release, which is the one moment you cannot afford to be learning things.

## What generalises

Two configurations that must agree will drift. Not might — will, as soon as one of them gets edited under pressure and the other isn't in the diff. Comments help a little, because they put the obligation where someone will read it. What actually holds is making one of them run the other's checks, so disagreement becomes a failure rather than a surprise.

And the first-order version, which I'd rather not need twice: a test result is a fact about one machine. If the machine you ran it on is the one you've been hand-fixing for months, it is the least informative machine available.

Next: the UI milestone, which is the first part of this rebuild anyone will actually look at — on a board I can now at least prove isn't stale.
