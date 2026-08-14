import { mkdir, readFile, rm, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "./paths.ts";

/**
 * Attachment bytes on disk.
 *
 * Files live beside the rest of the project's state rather than inside it: a
 * board is read on every session start and every board update, and inlining
 * file contents would make that cost grow with every screenshot someone drops
 * on a card. The task carries only the metadata.
 */

/** Nothing here is served to a browser as HTML — see the server's note on why. */
export async function writeAttachment(
  cwd: string,
  taskId: string,
  attachmentId: string,
  bytes: ArrayBuffer | Uint8Array,
): Promise<void> {
  const path = paths.attachment(cwd, taskId, attachmentId);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await Bun.write(path, bytes);
}

export async function readAttachment(
  cwd: string,
  taskId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  try {
    return await readFile(paths.attachment(cwd, taskId, attachmentId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function deleteAttachment(
  cwd: string,
  taskId: string,
  attachmentId: string,
): Promise<void> {
  await unlink(paths.attachment(cwd, taskId, attachmentId)).catch(() => {});
}

/** Called when a task is deleted, so its files do not outlive it. */
export async function deleteTaskAttachments(cwd: string, taskId: string): Promise<void> {
  await rm(paths.taskAttachments(cwd, taskId), { recursive: true, force: true }).catch(() => {});
}
