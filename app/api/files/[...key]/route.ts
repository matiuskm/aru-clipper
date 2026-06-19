import { NextResponse, type NextRequest } from 'next/server';
import type { ReadStream } from 'fs';
import path from 'path';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { statFile, readStream } from '@/lib/storage';

// Wrap a Node read stream as a web ReadableStream that tears down the file
// handle when the client aborts (e.g. video seeking), avoiding the
// "Controller is already closed" crash from blind enqueue-after-close.
function toWebStream(node: ReadStream): ReadableStream<Uint8Array> {
  let closed = false;
  return new ReadableStream({
    start(controller) {
      node.on('data', (chunk: string | Buffer) => {
        if (closed) return;
        controller.enqueue(new Uint8Array(chunk as Buffer));
        // Pause to respect backpressure; resumed on pull().
        node.pause();
      });
      node.on('end', () => {
        if (closed) return;
        closed = true;
        controller.close();
      });
      node.on('error', (err) => {
        if (closed) return;
        closed = true;
        controller.error(err);
      });
    },
    pull() {
      node.resume();
    },
    cancel() {
      closed = true;
      node.destroy();
    },
  });
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v',
};

// Serves files from local storage. Keys are shaped `videos/<projectId>/<file>`,
// so we authorize by checking the owning project belongs to the current user.
export async function GET(req: NextRequest, ctx: RouteContext<'/api/files/[...key]'>) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { key: segments } = await ctx.params;
  const key = segments.join('/');

  // Enforce ownership via the projectId embedded in the key.
  // Keys are shaped `videos/<projectId>/…` or `clips/<projectId>/…`.
  if ((segments[0] === 'videos' || segments[0] === 'clips') && segments[1]) {
    const project = await prisma.project.findFirst({
      where: { id: segments[1], userId: session.user.id },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  } else {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const stat = await statFile(key);
  if (!stat || !stat.isFile()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const contentType = MIME[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.get('range');

  // Honor HTTP range requests so <video> can seek and stream efficiently.
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` },
        });
      }
      const nodeStream = readStream(key, { start, end });
      return new NextResponse(toWebStream(nodeStream), {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
  }

  const nodeStream = readStream(key);
  return new NextResponse(toWebStream(nodeStream), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
    },
  });
}
