import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/storage';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/projects/[id]'>) {
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

  return NextResponse.json({ project });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/projects/[id]'>) {
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

  // Remove the stored source file (if any) before dropping the record.
  const storageKey = (project.metadata as { storageKey?: string } | null)?.storageKey;
  if (storageKey) await deleteFile(storageKey);

  await prisma.project.delete({ where: { id: project.id } });

  return NextResponse.json({ ok: true });
}
