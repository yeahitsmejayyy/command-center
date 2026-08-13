import { apply } from "../core/apply.ts";
import type { Event, Result } from "../core/types.ts";
import { transactState } from "./store.ts";

/**
 * One transaction: read the board, apply an event, persist the result.
 *
 * This lives here rather than in a surface because the CLI, the hook entry
 * points, and the server all need exactly this cycle. Duplicating it per
 * surface is how two surfaces end up disagreeing about what a mutation means.
 *
 * The entire cycle runs inside the project lock, so concurrent callers queue
 * instead of colliding: each one reads the previous one's committed result.
 * There is no retry loop because there is no race to lose.
 */
export function mutate(cwd: string, event: Event): Promise<Result> {
  return transactState(cwd, async (current) => {
    const result = apply(current, event);
    return { next: result.ok ? result.state : null, value: result };
  });
}
