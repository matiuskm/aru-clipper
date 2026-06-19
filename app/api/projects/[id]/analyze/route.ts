import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { enqueueAnalyze } from '@/lib/queue';

// Queue transcription + highlight analysis for a project the caller owns.
export async function POST(_req: NextRequest, ctx: RouteContext<'/api/projects/[id]/analyze'>) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const storageKey = (project.metadata as { storageKey?: string } | null)?.storageKey;
  if (!storageKey) {
    return NextResponse.json(
      { error: 'Project has no uploaded video to analyze' },
      { status: 400 }
    );
  }

  if (['transcribing', 'analyzing'].includes(project.status)) {
    return NextResponse.json({ error: 'Analysis already in progress' }, { status: 409 });
  }

  await prisma.project.update({ where: { id }, data: { status: 'queued' } });
  const job = await enqueueAnalyze(id);

  return NextResponse.json({ ok: true, jobId: job.id });
}
