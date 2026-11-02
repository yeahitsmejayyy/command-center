import { readFile } from "node:fs/promises";
import { z } from "zod";
import { DEFAULT_CONCURRENCY } from "../core/types.ts";
import { atomicWriteFile } from "./atomic.ts";
import { paths } from "./paths.ts";

/**
 * Per-project preferences: does this project use command-center, and how many
 * tasks may run at once?
 *
 * `enabled` is deliberately tri-state. "Never asked" is not the same as "said
 * no": the SessionStart hook offers the choice once and then stays quiet, so
 * collapsing undecided into false would mean the offer never appears, and
 * collapsing it into true would start a server nobody asked for.
 *
 * `concurrency` has no such ambiguity — an unset limit is one, which is what
 * the board did before the preference existed.
 */

const PrefsSchema = z.object({
  // Nullable on disk, not just in memory: setting a limit on a project that was
  // never asked has to be able to write "still undecided" back, or the limit is
  // lost to a file the schema then refuses.
  enabled: z.boolean().nullable(),
  updatedAt: z.number().int().nonnegative(),
  // Defaulted so a file written before M11 still parses, and still means one.
  concurrency: z.number().int().min(1).default(DEFAULT_CONCURRENCY),
});

export interface Prefs {
  enabled: boolean | null;
  concurrency: number;
}

const UNDECIDED: Prefs = { enabled: null, concurrency: DEFAULT_CONCURRENCY };

export async function readPrefs(cwd: string): Promise<Prefs> {
  try {
    const raw = await readFile(paths.prefs(cwd), "utf8");
    const parsed = PrefsSchema.safeParse(JSON.parse(raw));
    // Corrupt or foreign contents mean we do not know what the user wanted;
    // asking again is safer than assuming either answer.
    if (!parsed.success) return UNDECIDED;
    return { enabled: parsed.data.enabled, concurrency: parsed.data.concurrency };
  } catch {
    return UNDECIDED;
  }
}

export async function setEnabled(cwd: string, enabled: boolean): Promise<void> {
  await write(cwd, { enabled });
}

export async function setConcurrency(cwd: string, concurrency: number): Promise<void> {
  await write(cwd, { concurrency });
}

/**
 * Read, merge, write.
 *
 * Each setter changes one field, so writing the whole file from its argument
 * alone would silently reset the others — enabling a project would drop its
 * concurrency back to one. A project that was never asked stays unasked: there
 * is no answer to preserve, and inventing one here would consume the hook's
 * single chance to offer the choice.
 */
async function write(cwd: string, change: Partial<Pick<Prefs, "enabled" | "concurrency">>): Promise<void> {
  const current = await readPrefs(cwd);
  const enabled = change.enabled ?? current.enabled;
  const concurrency = change.concurrency ?? current.concurrency;

  await atomicWriteFile(
    paths.prefs(cwd),
    `${JSON.stringify({ enabled, updatedAt: Date.now(), concurrency }, null, 2)}\n`,
  );
}
