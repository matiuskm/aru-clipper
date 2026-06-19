// lib/queue.ts
import { Queue } from 'bullmq';
import { redis } from './redis';

export const VIDEO_PROCESSING_QUEUE = 'video-processing';

// Job names handled on the queue.
export const ANALYZE_JOB = 'analyze';
export const RENDER_CLIP_JOB = 'render-clip';

export const videoProcessingQueue = new Queue(VIDEO_PROCESSING_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: { count: 5 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 }, // 10s, 20s — ride out API spikes
  },
});

/** Enqueue transcription + highlight analysis for a project. */
export function enqueueAnalyze(projectId: string) {
  return videoProcessingQueue.add(ANALYZE_JOB, { projectId });
}

/** Enqueue rendering of a single clip. */
export function enqueueRenderClip(clipId: string) {
  return videoProcessingQueue.add(RENDER_CLIP_JOB, { clipId });
}
