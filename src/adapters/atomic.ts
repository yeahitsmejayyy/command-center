import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Crash-safe file writes.
 *
 * Write to a temp file in the same directory, flush it to disk, then rename over
 * the target. rename(2) within a filesystem is atomic, so a reader sees either
 * the whole old file or the whole new one — never a half-written mix, and never
 * a truncated file if the machine dies mid-write.
 *
 * The fsync matters: without it, rename can land while the data is still in the
 * page cache, and a power loss leaves a correctly-named empty file.
 */
export async function atomicWriteFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  // Same directory as the target: rename is only atomic within one filesystem.
  const tmp = join(dirname(path), `.${process.pid}-${counter++}.tmp`);

  let handle;
  try {
    handle = await open(tmp, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle?.close();
  }

  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

let counter = 0;
