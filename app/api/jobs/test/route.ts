import { NextResponse } from 'next/server';
import { videoProcessingQueue } from '@/lib/queue';

// Test endpoint to verify BullMQ enqueue works (Phase 1 validation).
// POST /api/jobs/test  -> enqueues a dummy job that the worker will process.
export async function POST() {
  const job = await videoProcessingQueue.add('test-job', {
    message: 'hello from clipper',
    at: new Date().toISOString(),
  });

  return NextResponse.json({ enqueued: true, jobId: job.id });
}
