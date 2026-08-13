import { stat } from "node:fs/promises";
import { paths } from "../../adapters/paths.ts";

/**
 * Detects state changes, whoever made them.
 *
 * Mutations arrive from two directions: the UI, over HTTP, and Claude running
 * `cmc finish` in a completely separate process. Broadcasting only what this
 * server did would leave the board silently stale exactly when the queue is
 * moving, so change detection watches the file rather than the request path.
 *
 * It polls a stat() rather than using fs.watch deliberately. Our writes are
 * atomic — a temp file renamed over the target — which replaces the inode and
 * breaks a file watcher, and fs.watch's behaviour varies by platform. One cheap
 * stat on an interval is boring, portable, and shared by every connected
 * client, unlike v1 where each open tab polled the full state independently.
 */

const DEFAULT_INTERVAL_MS = 400;

export interface Watcher {
  stop(): void;
}

export function watchState(
  cwd: string,
  onChange: () => void,
  intervalMs = DEFAULT_INTERVAL_MS,
): Watcher {
  const path = paths.state(cwd);
  // null is a real value here — "no state file" — so a separate flag is needed
  // to tell "nothing observed yet" from "observed nothing". Conflating the two
  // means the first task ever created never announces itself.
  let previous: string | null = null;
  let established = false;
  let stopped = false;

  const tick = async () => {
    let signature: string | null;
    try {
      const info = await stat(path);
      signature = `${info.mtimeMs}:${info.size}`;
    } catch {
      signature = null; // no state file: absent is a state, not an error
    }

    if (established && signature !== previous) onChange();
    previous = signature;
    established = true;
  };

  void tick(); // establish a baseline without firing
  const timer = setInterval(() => {
    if (!stopped) void tick();
  }, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
