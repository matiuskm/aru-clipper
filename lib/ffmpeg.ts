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

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${h}:${p(m)}:${p(ss)}.${p(cs)}`;
}

/**
 * Split long cues into short caption chunks (~max words) so on-screen text
 * stays to 1-2 lines and doesn't jump around. Time is shared across chunks.
 */
export function chunkCues(cues: SubtitleCue[], maxWords = 6): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  for (const c of cues) {
    const words = c.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const groups: string[] = [];
    for (let i = 0; i < words.length; i += maxWords) {
      groups.push(words.slice(i, i + maxWords).join(' '));
    }
    const per = (c.end - c.start) / groups.length;
    groups.forEach((text, i) => {
      out.push({ start: c.start + i * per, end: c.start + (i + 1) * per, text });
    });
  }
  return out;
}

/**
 * Build an ASS subtitle file with a fixed 1080x1920 script resolution so the
 * font size is predictable (not auto-scaled huge) and captions are pinned to a
 * fixed band near the bottom.
 */
function buildAss(cues: SubtitleCue[], fontName: string): string {
  const escape = (t: string) => t.replace(/[\r\n]+/g, ' ').replace(/\{/g, '(').replace(/\}/g, ')');
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${OUTPUT_W}
PlayResY: ${OUTPUT_H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Default,${fontName},58,&H00FFFFFF,&H00000000,&H64000000,1,4,0,2,120,120,320

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = cues
    .filter((c) => c.end > c.start && c.text.trim())
    .map(
      (c) =>
        `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${escape(c.text.trim())}`
    )
    .join('\n');
  return `${header}\n${events}\n`;
}

/**
 * Render a clip. Returns the output path. Caller owns input/output paths.
 * Layout: the source video full-width centered over a blurred fill of itself
 * (no black bars), with optional burned-in captions and a hook headline.
 */
export async function renderShortClip(opts: RenderOptions): Promise<string> {
  const { inputPath, outputPath, start, duration, hookText, subtitles = [] } = opts;
  const font = findFont();
  const tmp: string[] = [];

  // Blurred-background fill: split input → blurred cover behind, real video on top.
  const steps: string[] = [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=${OUTPUT_W}:${OUTPUT_H}:force_original_aspect_ratio=increase,crop=${OUTPUT_W}:${OUTPUT_H},gblur=sigma=24,eq=brightness=-0.08[bgb]`,
    `[fg]scale=${OUTPUT_W}:-2[fgs]`,
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]`,
  ];
  let last = 'v0';

  // Captions (ASS via libass) — fixed size + bottom band, chunked to short lines.
  if (subtitles.length > 0 && font) {
    const assPath = path.join(os.tmpdir(), `clipper-sub-${Date.now()}-${process.pid}.ass`);
    const fontName = path.basename(font).replace(/\.[^.]+$/, '');
    await fs.writeFile(assPath, buildAss(chunkCues(subtitles), fontName));
    tmp.push(assPath);
    steps.push(
      `[${last}]subtitles=${escapeFilterPath(assPath)}:fontsdir=${escapeFilterPath(path.dirname(font))}[v1]`
    );
    last = 'v1';
  }

  // Hook headline near the top — textfile avoids filtergraph escaping issues.
  if (hookText && font) {
    const hookPath = path.join(os.tmpdir(), `clipper-hook-${Date.now()}-${process.pid}.txt`);
    await fs.writeFile(hookPath, wrapText(hookText, 24));
    tmp.push(hookPath);
    steps.push(
      `[${last}]drawtext=fontfile=${escapeFilterPath(font)}:textfile=${escapeFilterPath(hookPath)}` +
        `:expansion=none:fontcolor=white:fontsize=56:line_spacing=12` +
        `:box=1:boxcolor=black@0.5:boxborderw=22:x=(w-text_w)/2:y=130[v2]`
    );
    last = 'v2';
  }

  const filterComplex = steps.join(';');

  try {
    await run([
      '-ss', String(start),
      '-i', inputPath,
      '-t', String(duration),
      '-filter_complex', filterComplex,
      '-map', `[${last}]`,
      '-map', '0:a?',
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
