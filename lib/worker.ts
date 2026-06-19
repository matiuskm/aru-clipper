// lib/worker.ts
import { Worker } from 'bullmq';
import { redis } from './redis';
import { VIDEO_PROCESSING_QUEUE, ANALYZE_JOB, RENDER_CLIP_JOB } from './queue';
import { processAnalyzeJob } from './jobs/analyze-job';
import { processRenderClipJob } from './jobs/render-clip-job';

export const videoWorker = new Worker(
  VIDEO_PROCESSING_QUEUE,
  async (job) => {
    console.log(`Processing job ${job.id} (${job.name}) with data:`, job.data);

    switch (job.name) {
      case ANALYZE_JOB:
        return processAnalyzeJob(job);
      case RENDER_CLIP_JOB:
        return processRenderClipJob(job);
      default:
        console.warn(`No handler for job "${job.name}" — skipping`);
        return { success: true, skipped: true };
    }
  },
  // Keep concurrency modest — AI calls are the bottleneck/cost driver.
  { connection: redis, concurrency: 2 }
);

videoWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

videoWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

videoWorker.on('ready', () => {
  console.log(`Worker listening on "${VIDEO_PROCESSING_QUEUE}" queue...`);
});

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down worker...');
  await videoWorker.close();
  await redis.quit();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
