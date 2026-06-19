import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { buildVideoKey, saveFile, publicUrl } from '@/lib/storage';

// MVP cap — keep uploads modest while running on local disk.
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
const ACCEPTED = /^video\//;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('video');
  const title = (formData.get('title') as string | null)?.trim();

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No video file provided' }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }
  if (!ACCEPTED.test(file.type)) {
    return NextResponse.json({ error: 'File must be a video' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_BYTES / (1024 * 1024)}MB limit` },
      { status: 413 }
    );
  }

  // Create the record first so the storage key can be namespaced by project id.
  const project = await prisma.project.create({
    data: {
      userId: session.user.id,
      title,
      sourceType: 'upload',
      status: 'uploading',
    },
  });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = buildVideoKey(project.id, file.name);
    await saveFile(buffer, key);

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        videoUrl: publicUrl(key),
        status: 'uploaded',
        metadata: {
          storageKey: key,
          originalName: file.name,
          size: file.size,
          mimeType: file.type,
        },
      },
    });

    // Processing pipeline (transcription/highlights) is queued in a later phase.
    // await videoProcessingQueue.add('analyze', { projectId: project.id });

    return NextResponse.json({ project: updated }, { status: 201 });
  } catch (err) {
    console.error('[upload] failed:', err);
    await prisma.project.update({
      where: { id: project.id },
      data: { status: 'failed' },
    });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
