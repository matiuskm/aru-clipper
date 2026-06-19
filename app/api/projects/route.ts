import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { clips: true } } },
  });

  return NextResponse.json({ projects });
}

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  sourceType: z.enum(['upload', 'youtube']),
  sourceUrl: z.string().url().optional(),
});

// Create an empty project record (metadata only). Actual media is attached via
// /api/projects/upload (local file) or /api/projects/youtube (URL import).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 }
    );
  }

  const project = await prisma.project.create({
    data: {
      userId: session.user.id,
      title: parsed.data.title,
      sourceType: parsed.data.sourceType,
      sourceUrl: parsed.data.sourceUrl,
      status: 'pending',
    },
  });

  return NextResponse.json({ project }, { status: 201 });
}
