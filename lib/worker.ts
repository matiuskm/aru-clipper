// lib/worker.ts
import { Worker } from 'bullmq';
import { redis } from './redis';
import { VIDEO_PROCESSING_QUEUE } from './queue';

export const videoWorker = new Worker(
  VIDEO_PROCESSING_QUEUE,
  async (job) => {
    console.log(`Processing job ${job.id} with data:`, job.data);

    // TODO: Logic processing akan ditambahkan di fase selanjutnya
    // Contoh: transcription, highlight detection, dll.

    return { success: true, message: 'Job completed' };
  },
  { connection: redis }
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
