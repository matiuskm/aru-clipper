// lib/queue.ts
import { Queue } from 'bullmq';
import { redis } from './redis';

export const VIDEO_PROCESSING_QUEUE = 'video-processing';

export const videoProcessingQueue = new Queue(VIDEO_PROCESSING_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: { count: 5 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
});
