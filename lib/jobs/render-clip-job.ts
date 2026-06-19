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

export interface RenderClipJobData {
  clipId: string;
}

/** Pick transcript segments inside [start, end] and rebase to clip-relative time. */
export function cuesForWindow(segments: Segment[], start: number, end: number): SubtitleCue[] {
  return segments
    .filter((s) => s.end > start && s.start < end)
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
      data: { renderUrl: publicUrl(key), status: 'completed' },
    });

    return { clipId, renderUrl: updated.renderUrl };
  } catch (err) {
    console.error(`[render-clip-job] clip ${clipId} failed:`, err);
    await prisma.clip
      .update({ where: { id: clipId }, data: { status: 'failed' } })
      .catch(() => {});
    throw err;
  }
}
