// lib/ffmpeg.ts
//
// Render a vertical 9:16 short clip from a source video: cut [start, start+dur],
// scale/pad to 1080x1920, optionally burn in a hook headline (drawtext) and
// subtitles (libass). Uses the bundled ffmpeg-static binary.

import { spawn } from 'child_process';
import { promises as fs, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';

const FFMPEG = (ffmpegPath as unknown as string) || 'ffmpeg';

export const OUTPUT_W = 1080;
export const OUTPUT_H = 1920;

export interface SubtitleCue {
  start: number; // seconds, relative to clip start
  end: number;
  text: string;
}

export interface RenderOptions {
  inputPath: string;
  outputPath: string;
  start: number; // seconds into the source
  duration: number; // clip length in seconds
  hookText?: string;
  subtitles?: SubtitleCue[];
}

// First system font that exists — drawtext/libass need a real font file.
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
];

function findFont(): string | null {
  return FONT_CANDIDATES.find((f) => existsSync(f)) ?? null;
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`))
    );
  });
}

/** Escape a filesystem path for use inside an ffmpeg filtergraph value. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** Word-wrap a hook headline so drawtext renders it on multiple lines. */
function wrapText(text: string, maxChars = 22): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function srtTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(ss)},${p(ms, 3)}`;
}

function buildSrt(cues: SubtitleCue[]): string {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text.trim()}`
    )
    .join('\n\n');
}

/**
 * Render a clip. Returns the output path. Caller owns input/output paths.
 * Temp files (hook text, subtitle srt) are cleaned up automatically.
 */
export async function renderShortClip(opts: RenderOptions): Promise<string> {
  const { inputPath, outputPath, start, duration, hookText, subtitles = [] } = opts;
  const font = findFont();
  const tmp: string[] = [];

  // Base: vertical letterbox/pad to 1080x1920.
  let vf = `scale=${OUTPUT_W}:${OUTPUT_H}:force_original_aspect_ratio=decrease,pad=${OUTPUT_W}:${OUTPUT_H}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

  // Subtitles burn-in (libass) — needs a font present.
  if (subtitles.length > 0 && font) {
    const srtPath = path.join(os.tmpdir(), `clipper-sub-${Date.now()}-${process.pid}.srt`);
    await fs.writeFile(srtPath, buildSrt(subtitles));
    tmp.push(srtPath);
    const fontsDir = path.dirname(font);
    const fontName = path.basename(font).replace(/\.[^.]+$/, '');
    vf +=
      `,subtitles=${escapeFilterPath(srtPath)}:fontsdir=${escapeFilterPath(fontsDir)}` +
      `:force_style='FontName=${fontName},FontSize=16,PrimaryColour=&H00FFFFFF,` +
      `OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=120'`;
  }

  // Hook headline overlay near the top — use textfile to avoid escaping hell.
  if (hookText && font) {
    const hookPath = path.join(os.tmpdir(), `clipper-hook-${Date.now()}-${process.pid}.txt`);
    await fs.writeFile(hookPath, wrapText(hookText));
    tmp.push(hookPath);
    vf +=
      `,drawtext=fontfile=${escapeFilterPath(font)}:textfile=${escapeFilterPath(hookPath)}` +
      `:expansion=none:fontcolor=white:fontsize=64:line_spacing=10` +
      `:box=1:boxcolor=black@0.55:boxborderw=24` +
      `:x=(w-text_w)/2:y=140`;
  }

  try {
    await run([
      '-ss', String(start),
      '-i', inputPath,
      '-t', String(duration),
      '-vf', vf,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outputPath,
    ]);
    return outputPath;
  } finally {
    await Promise.all(tmp.map((f) => fs.unlink(f).catch(() => {})));
  }
}

export { findFont };
