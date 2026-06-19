// lib/media.ts
//
// Thin wrappers around the bundled ffmpeg binary (ffmpeg-static). We spawn the
// binary directly rather than via fluent-ffmpeg's ffprobe, so we don't need a
// separate ffprobe install.

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';

const FFMPEG = (ffmpegPath as unknown as string) || 'ffmpeg';

function run(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/** Parse the `Duration: HH:MM:SS.ms` line from ffmpeg output → seconds. */
function parseDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
}

/**
 * Extract a compact mono 16 kHz MP3 from a video file — ideal for Whisper and
 * far smaller than the source. Returns the temp audio path and video duration.
 * Caller is responsible for deleting the temp file.
 */
export async function extractAudio(
  videoPath: string
): Promise<{ audioPath: string; durationSec: number }> {
  const audioPath = path.join(os.tmpdir(), `clipper-${Date.now()}-${process.pid}.mp3`);
  const { code, stderr } = await run([
    '-i', videoPath,
    '-vn', // drop video
    '-ac', '1', // mono
    '-ar', '16000', // 16 kHz
    '-b:a', '64k',
    '-y', audioPath,
  ]);

  if (code !== 0) {
    await fs.unlink(audioPath).catch(() => {});
    throw new Error(`ffmpeg audio extraction failed (code ${code}): ${stderr.slice(-500)}`);
  }

  return { audioPath, durationSec: parseDuration(stderr) ?? 0 };
}

/** Probe just the duration (seconds) of a media file. */
export async function getDuration(videoPath: string): Promise<number> {
  const { stderr } = await run(['-i', videoPath]);
  return parseDuration(stderr) ?? 0;
}
