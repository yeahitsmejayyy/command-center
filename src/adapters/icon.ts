import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "./paths.ts";

/**
 * The project's board icon: the bytes, and what counts as an image.
 *
 * The choice itself (default, emoji, or image) lives in preferences — it is a
 * per-project setting like `enabled` and `concurrency`. Only the pixels live
 * here, for the same reason attachments do: the board's state is read on every
 * session start and every update, and an inlined image would make that cost
 * grow with the picture someone chose.
 */

/** 512 square is what the shipped icons are, and what the upload control says. */
export const RECOMMENDED_ICON_PX = 512;

/**
 * One megabyte.
 *
 * Attachments get 25 MB because they are evidence — a screenshot, a log. An
 * icon is drawn at 22 CSS pixels and is fetched on every board load, so the
 * ceiling is set by what is reasonable to re-download, not by what is
 * reasonable to keep.
 */
export const MAX_ICON_BYTES = 1024 * 1024;

/**
 * The formats an icon may be in.
 *
 * SVG is deliberately absent. An SVG is an active document: it can carry script
 * and external references, and the board serves this file inline from its own
 * origin — which is exactly the privilege an uploaded file must never have.
 * Attachments dodge this by being served as downloads with a sandbox CSP; an
 * icon has to render, so the format has to be inert instead.
 */
const SIGNATURES: readonly { mediaType: string; test: (b: Uint8Array) => boolean }[] = [
  { mediaType: "image/png", test: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mediaType: "image/jpeg", test: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { mediaType: "image/gif", test: (b) => starts(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    mediaType: "image/webp",
    test: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
];

function starts(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, i) => bytes[i] === byte);
}

/**
 * What these bytes actually are, or null.
 *
 * The upload's own Content-Type is a claim made by whoever sent it, so it is
 * never consulted: the file is identified by its leading bytes and served back
 * as whatever those say, never as whatever the uploader said.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  return SIGNATURES.find((s) => s.test(bytes))?.mediaType ?? null;
}

export async function writeIcon(cwd: string, bytes: Uint8Array): Promise<void> {
  const path = paths.icon(cwd);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await Bun.write(path, bytes);
}

export async function readIcon(cwd: string): Promise<Buffer | null> {
  try {
    return await readFile(paths.icon(cwd));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function deleteIcon(cwd: string): Promise<void> {
  await unlink(paths.icon(cwd)).catch(() => {});
}
