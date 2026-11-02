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
 * the board did before the preference existed. Nor does `icon`: a project that
 * never picked one shows the command-center mark, as every project used to.
 */

/**
 * What the board draws in place of the command-center mark.
 *
 * "default" is stored rather than inferred from an absent field so that
 * clearing a choice is a write like any other — the alternative is deleting a
 * key, and a merge-write that cannot represent "back to default" would make
 * the reset button the one setter that has to special-case itself.
 *
 * The image variant carries no filename. The bytes live at paths.icon(cwd),
 * one per project; `updatedAt` exists so the board can bust its own cache
 * after an upload replaces a file at an unchanged URL.
 */
export type BoardIcon =
  | { kind: "default" }
  | { kind: "emoji"; value: string }
  | { kind: "image"; mediaType: string; updatedAt: number };

/**
 * An emoji is a handful of code points, not a sentence.
 *
 * A flag is two regional indicators; a profession with a skin tone and a
 * gender runs to seven code points joined by zero-width joiners. Sixteen UTF-16
 * code units covers those with room to spare and still refuses a paragraph
 * pasted into a field that draws its contents at 19 pixels.
 */
export const MAX_EMOJI_LENGTH = 16;

const PrefsSchema = z.object({
  // Nullable on disk, not just in memory: setting a limit on a project that was
  // never asked has to be able to write "still undecided" back, or the limit is
  // lost to a file the schema then refuses.
  enabled: z.boolean().nullable(),
  updatedAt: z.number().int().nonnegative(),
  // Defaulted so a file written before M11 still parses, and still means one.
  concurrency: z.number().int().min(1).default(DEFAULT_CONCURRENCY),
  // Same again: a file written before this existed means the default mark.
  icon: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("default") }),
      z.object({ kind: z.literal("emoji"), value: z.string().min(1).max(MAX_EMOJI_LENGTH) }),
      z.object({
        kind: z.literal("image"),
        mediaType: z.string().min(1).max(64),
        updatedAt: z.number().int().nonnegative(),
      }),
    ])
    .default({ kind: "default" }),
});

export interface Prefs {
  enabled: boolean | null;
  concurrency: number;
  icon: BoardIcon;
}

const DEFAULT_ICON: BoardIcon = { kind: "default" };
const UNDECIDED: Prefs = { enabled: null, concurrency: DEFAULT_CONCURRENCY, icon: DEFAULT_ICON };

export async function readPrefs(cwd: string): Promise<Prefs> {
  try {
    const raw = await readFile(paths.prefs(cwd), "utf8");
    const parsed = PrefsSchema.safeParse(JSON.parse(raw));
    // Corrupt or foreign contents mean we do not know what the user wanted;
    // asking again is safer than assuming either answer.
    if (!parsed.success) return UNDECIDED;
    return {
      enabled: parsed.data.enabled,
      concurrency: parsed.data.concurrency,
      icon: parsed.data.icon,
    };
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

export async function setIcon(cwd: string, icon: BoardIcon): Promise<void> {
  await write(cwd, { icon });
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
async function write(
  cwd: string,
  change: Partial<Pick<Prefs, "enabled" | "concurrency" | "icon">>,
): Promise<void> {
  const current = await readPrefs(cwd);
  const enabled = change.enabled ?? current.enabled;
  const concurrency = change.concurrency ?? current.concurrency;
  const icon = change.icon ?? current.icon;

  await atomicWriteFile(
    paths.prefs(cwd),
    `${JSON.stringify({ enabled, updatedAt: Date.now(), concurrency, icon }, null, 2)}\n`,
  );
}
