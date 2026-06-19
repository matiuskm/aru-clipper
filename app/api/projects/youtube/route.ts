import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

// Accept the common YouTube URL shapes (watch, youtu.be, shorts, embed).
const YT_HOST = /(^|\.)(youtube\.com|youtu\.be)$/i;

const importSchema = z.object({
  url: z.string().url(),
  title: z.string().trim().min(1).max(200).optional(),
});

/** Fetch title + thumbnail via YouTube's public oEmbed endpoint (no API key). */
async function fetchOEmbed(url: string) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      title?: string;
      thumbnail_url?: string;
      author_name?: string;
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = importSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A valid YouTube URL is required' }, { status: 400 });
  }

  const { url } = parsed.data;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }
  if (!YT_HOST.test(host)) {
    return NextResponse.json({ error: 'URL must be a YouTube link' }, { status: 400 });
  }

  const info = await fetchOEmbed(url);
  const title = parsed.data.title || info?.title || 'Untitled YouTube import';

  // MVP: we store the source URL and metadata only. Downloading/streaming the
  // actual media to local storage happens in the processing worker (later phase),
  // so we mark the project as pending rather than uploaded.
  const project = await prisma.project.create({
    data: {
      userId: session.user.id,
      title,
      sourceType: 'youtube',
      sourceUrl: url,
      status: 'pending',
      metadata: {
        thumbnail: info?.thumbnail_url ?? null,
        author: info?.author_name ?? null,
      },
    },
  });

  return NextResponse.json({ project }, { status: 201 });
}
