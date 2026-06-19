// lib/jobs/render-clip-job.ts
//
// BullMQ job: render a single clip to a vertical 9:16 video with hook overlay
// and burned-in subtitles, then store it and record renderUrl.
// Clip status: pending → rendering → completed (or → failed).

import type { Job } from 'bullmq';
import { prisma } from '../prisma';
import { resolveKey, buildClipKey, ensureKeyPath, publicUrl } from '../storage';
import { renderShortClip, type SubtitleCue } from '../ffmpeg';
import type { Segment } from '../ai';
import { friendlyError } from '../error';

export interface RenderClipJobData {
  clipId: string;
}

/**
 * Build caption cues for the clip window [start, end], rebased to clip-relative
 * time. Prefers word-level timing (accurate sync, grouped into short phrases);
 * falls back to whole segments for transcripts without word data.
 */
export function cuesForWindow(
  segments: Segment[],
  start: number,
  end: number,
  wordsPerCue = 5
): SubtitleCue[] {
  const inWindow = segments.filter((s) => s.end > start && s.start < end);
  const words = inWindow
    .flatMap((s) => s.words ?? [])
    .filter((w) => w.end > start && w.start < end && w.text);

  // Word-level path: group consecutive words into short, well-timed cues.
  if (words.length > 0) {
    const cues: SubtitleCue[] = [];
    for (let i = 0; i < words.length; i += wordsPerCue) {
      const group = words.slice(i, i + wordsPerCue);
      cues.push({
        start: Math.max(0, group[0].start - start),
        end: Math.min(end, group[group.length - 1].end) - start,
        text: group.map((w) => w.text).join(' '),
      });
    }
    return cues.filter((c) => c.end > c.start && c.text.trim());
  }

  // Fallback: segment-level cues (older transcripts without word timings).
  return inWindow
    .map((s) => ({
      start: Math.max(0, s.start - start),
      end: Math.min(end, s.end) - start,
      text: s.text,
    }))
    .filter((c) => c.end > c.start && c.text);
}

export async function processRenderClipJob(job: Job<RenderClipJobData>) {
  const { clipId } = job.data;

  const clip = await prisma.clip.findUnique({ where: { id: clipId } });
  if (!clip) throw new Error(`Clip ${clipId} not found`);

  const project = await prisma.project.findUnique({ where: { id: clip.projectId } });
  const storageKey = (project?.metadata as { storageKey?: string } | null)?.storageKey;
  if (!storageKey) throw new Error('Source video not found for clip');

  await prisma.clip.update({ where: { id: clipId }, data: { status: 'rendering' } });

  try {
    const transcript = await prisma.transcript.findFirst({
      where: { projectId: clip.projectId },
      orderBy: { createdAt: 'desc' },
    });
    const segments = (transcript?.transcriptJson as unknown as Segment[]) ?? [];

    const key = buildClipKey(clip.projectId, clip.id);
    const outputPath = await ensureKeyPath(key);

    await renderShortClip({
      inputPath: resolveKey(storageKey),
      outputPath,
      start: clip.startSecond,
      duration: Math.max(1, clip.endSecond - clip.startSecond),
      hookText: clip.hookText ?? undefined,
      subtitles: cuesForWindow(segments, clip.startSecond, clip.endSecond),
    });

    const updated = await prisma.clip.update({
      where: { id: clipId },
      data: { renderUrl: publicUrl(key), status: 'completed', errorMessage: null },
    });

    return { clipId, renderUrl: updated.renderUrl };
  } catch (err) {
    console.error(`[render-clip-job] clip ${clipId} failed:`, err);
    await prisma.clip
      .update({
        where: { id: clipId },
        data: { status: 'failed', errorMessage: friendlyError(err) },
      })
      .catch(() => {});
    throw err;
  }
}
