import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { enqueueRenderClip } from '@/lib/queue';

// Render all (not-yet-rendering) clips of a project the caller owns.
export async function POST(_req: NextRequest, ctx: RouteContext<'/api/projects/[id]/render'>) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
    include: { clips: true },
  });
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const storageKey = (project.metadata as { storageKey?: string } | null)?.storageKey;
  if (!storageKey) {
    return NextResponse.json({ error: 'Source video not available' }, { status: 400 });
  }

  const targets = project.clips.filter((c) => c.status !== 'rendering');
  if (targets.length === 0) {
    return NextResponse.json({ error: 'No clips to render' }, { status: 400 });
  }

  await prisma.clip.updateMany({
    where: { id: { in: targets.map((c) => c.id) } },
    data: { status: 'rendering' },
  });
  await Promise.all(targets.map((c) => enqueueRenderClip(c.id)));

  return NextResponse.json({ ok: true, queued: targets.length });
}
