// lib/storage.ts
//
// Local filesystem storage — a drop-in stand-in for Cloudflare R2 during
// development. Files are written under STORAGE_DIR (default: ./storage) and
// served back to the browser through the `/api/files/[...key]` route handler.
//
// When we move to R2, only this module and the file-serving route need to
// change; the rest of the app talks to storage through these helpers.

import { promises as fs } from 'fs';
import path from 'path';
import { createReadStream } from 'fs';

// Absolute path to the storage root. Kept outside `public/` so files are only
// reachable through the authenticated /api/files route, never served statically.
export const STORAGE_ROOT = path.resolve(
  process.cwd(),
  process.env.STORAGE_DIR || 'storage'
);

/** Strip characters that could break a filesystem path or enable traversal. */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

/**
 * Build the storage key for a project's source video.
 * Shape mirrors the R2 layout: `videos/<projectId>/<timestamp>-<name>`.
 */
export function buildVideoKey(projectId: string, fileName: string): string {
  return `videos/${projectId}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

/** Build the storage key for a rendered clip: `clips/<projectId>/<clipId>.mp4`. */
export function buildClipKey(projectId: string, clipId: string): string {
  return `clips/${projectId}/${clipId}.mp4`;
}

/** Ensure the parent directory exists and return the absolute path for a key. */
export async function ensureKeyPath(key: string): Promise<string> {
  const target = resolveKey(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  return target;
}

/** Resolve a storage key to an absolute path, guarding against traversal. */
export function resolveKey(key: string): string {
  const target = path.resolve(STORAGE_ROOT, key);
  if (target !== STORAGE_ROOT && !target.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error('Invalid storage key');
  }
  return target;
}

/** Write a buffer to storage under `key`, creating parent directories. */
export async function saveFile(buffer: Buffer, key: string): Promise<void> {
  const target = resolveKey(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
}

/** Public URL the browser uses to fetch a stored file. */
export function publicUrl(key: string): string {
  return `/api/files/${key}`;
}

/** Read a stored file's stats (size, mtime). Returns null if missing. */
export async function statFile(key: string) {
  try {
    return await fs.stat(resolveKey(key));
  } catch {
    return null;
  }
}

/** Open a readable stream for a stored file (used by the file-serving route). */
export function readStream(key: string, opts?: { start: number; end: number }) {
  return createReadStream(resolveKey(key), opts);
}

/** Delete a stored file if it exists (best-effort, no throw on missing). */
export async function deleteFile(key: string): Promise<void> {
  try {
    await fs.unlink(resolveKey(key));
  } catch {
    /* already gone */
  }
}
