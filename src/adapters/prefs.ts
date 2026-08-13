import { readFile } from "node:fs/promises";
import { z } from "zod";
import { atomicWriteFile } from "./atomic.ts";
import { paths } from "./paths.ts";

/**
 * Per-project preference: does this project use command-center?
 *
 * `enabled` is deliberately tri-state. "Never asked" is not the same as "said
 * no": the SessionStart hook offers the choice once and then stays quiet, so
 * collapsing undecided into false would mean the offer never appears, and
 * collapsing it into true would start a server nobody asked for.
 */

const PrefsSchema = z.object({
  enabled: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
});

export interface Prefs {
  enabled: boolean | null;
}

export async function readPrefs(cwd: string): Promise<Prefs> {
  try {
    const raw = await readFile(paths.prefs(cwd), "utf8");
    const parsed = PrefsSchema.safeParse(JSON.parse(raw));
    // Corrupt or foreign contents mean we do not know what the user wanted;
    // asking again is safer than assuming either answer.
    return parsed.success ? { enabled: parsed.data.enabled } : { enabled: null };
  } catch {
    return { enabled: null };
  }
}

export async function setEnabled(cwd: string, enabled: boolean): Promise<void> {
  await atomicWriteFile(
    paths.prefs(cwd),
    `${JSON.stringify({ enabled, updatedAt: Date.now() }, null, 2)}\n`,
  );
}
