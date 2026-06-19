// lib/jobs/analyze-job.ts
//
// BullMQ job: transcribe a project's video, ask the AI for highlight clips,
// and persist the transcript + clips. Status transitions:
//   queued → transcribing → analyzing → completed   (or → failed on error)

import type { Job } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { prisma } from '../prisma';
import { resolveKey } from '../storage';
import { extractAudio } from '../media';
import { transcribeAudio, analyzeHighlights, type Segment } from '../ai';

export interface AnalyzeJobData {
  projectId: string;
}

export async function processAnalyzeJob(job: Job<AnalyzeJobData>) {
  const { projectId } = job.data;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`Project ${projectId} not found`);

  const storageKey = (project.metadata as { storageKey?: string } | null)?.storageKey;
  if (!storageKey) {
    // YouTube projects have no local media yet — downloading is a later phase.
    throw new Error('No local video file to analyze (storageKey missing)');
  }

  let audioPath: string | undefined;
  try {
    const videoPath = resolveKey(storageKey);

    // Idempotency: clear prior clips so re-analyze / retries don't pile up.
    // NOTE: transcripts are NOT cleared — transcription is expensive and rate
    // limited (Groq). On a retry (e.g. Gemini 503) we reuse the existing one
    // instead of burning quota re-transcribing.
    await prisma.clip.deleteMany({ where: { projectId } });

    // 1. Transcribe (or reuse) ------------------------------------------------
    let transcript: Segment[];
    let durationSec = 0;
    const existing = await prisma.transcript.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      transcript = existing.transcriptJson as unknown as Segment[];
    } else {
      await prisma.project.update({
        where: { id: projectId },
        data: { status: 'transcribing' },
      });
      const extracted = await extractAudio(videoPath);
      audioPath = extracted.audioPath;
      durationSec = extracted.durationSec;
      transcript = await transcribeAudio(audioPath);
      await prisma.transcript.create({
        data: { projectId, transcriptJson: transcript as unknown as Prisma.InputJsonValue },
      });
    }

    // Persist detected duration for downstream phases.
    const duration = durationSec || transcript.at(-1)?.end || 0;
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'analyzing',
        metadata: { ...(project.metadata as object), duration },
      },
    });

    // 2. Analyze highlights ---------------------------------------------------
    const highlights = await analyzeHighlights(transcript, duration);

    // 3. Save clips -----------------------------------------------------------
    if (highlights.length > 0) {
      await prisma.clip.createMany({
        data: highlights.map((h) => ({
          projectId,
          title: h.title,
          startSecond: h.start,
          endSecond: h.end,
          score: h.score,
          hookText: h.hook,
          status: 'pending',
        })),
      });
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'completed' },
    });

    return { transcriptSegments: transcript.length, clips: highlights.length };
  } catch (err) {
    console.error(`[analyze-job] project ${projectId} failed:`, err);
    await prisma.project
      .update({ where: { id: projectId }, data: { status: 'failed' } })
      .catch(() => {});
    throw err;
  } finally {
    if (audioPath) await fs.unlink(audioPath).catch(() => {});
  }
}
