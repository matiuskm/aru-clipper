import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { enqueueRenderClip } from '@/lib/queue';

// Render a single clip the caller owns (ownership via clip → project → user).
export async function POST(_req: NextRequest, ctx: RouteContext<'/api/clips/[id]/render'>) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const clip = await prisma.clip.findFirst({
    where: { id, project: { userId: session.user.id } },
    include: { project: { select: { metadata: true } } },
  });
  if (!clip) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const storageKey = (clip.project.metadata as { storageKey?: string } | null)?.storageKey;
  if (!storageKey) {
    return NextResponse.json({ error: 'Source video not available' }, { status: 400 });
  }
  if (clip.status === 'rendering') {
    return NextResponse.json({ error: 'Clip already rendering' }, { status: 409 });
  }

  await prisma.clip.update({ where: { id }, data: { status: 'rendering' } });
  const job = await enqueueRenderClip(id);

  return NextResponse.json({ ok: true, jobId: job.id });
}
