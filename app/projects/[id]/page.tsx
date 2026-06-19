import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { StatusBadge } from '@/components/status-badge';
import { DeleteButton } from './delete-button';
import { AnalyzePanel } from './analyze-panel';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
    include: { clips: { orderBy: { score: 'desc' } } },
  });

  if (!project) notFound();

  const meta = project.metadata as
    | { originalName?: string; size?: number; thumbnail?: string; author?: string }
    | null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <Link href="/projects" className="text-sm text-black/60 underline dark:text-white/60">
          ← Projects
        </Link>
        <DeleteButton projectId={project.id} />
      </div>

      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{project.title}</h1>
          <StatusBadge status={project.status} />
        </div>
        <p className="text-sm text-black/50 dark:text-white/50">
          {project.sourceType === 'youtube' ? 'YouTube import' : 'Local upload'} · dibuat{' '}
          {project.createdAt.toLocaleString()}
        </p>
      </header>

      {/* Preview */}
      <section className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
        {project.sourceType === 'upload' && project.videoUrl ? (
          <video src={project.videoUrl} controls className="aspect-video w-full bg-black" />
        ) : project.sourceType === 'youtube' && project.sourceUrl ? (
          <a
            href={project.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="block aspect-video w-full bg-black"
          >
            {meta?.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={meta.thumbnail} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-white/70">
                Buka di YouTube ↗
              </span>
            )}
          </a>
        ) : (
          <div className="flex aspect-video items-center justify-center bg-black/5 text-black/50 dark:bg-white/5 dark:text-white/50">
            Belum ada video
          </div>
        )}
      </section>

      {/* Metadata */}
      <section className="rounded-xl border border-black/10 p-5 text-sm dark:border-white/15">
        <h2 className="mb-3 font-medium">Detail</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-black/70 dark:text-white/70">
          <dt className="text-black/50 dark:text-white/50">Source</dt>
          <dd>{project.sourceType}</dd>
          {project.sourceUrl && (
            <>
              <dt className="text-black/50 dark:text-white/50">URL</dt>
              <dd className="truncate">
                <a href={project.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                  {project.sourceUrl}
                </a>
              </dd>
            </>
          )}
          {meta?.originalName && (
            <>
              <dt className="text-black/50 dark:text-white/50">File</dt>
              <dd>{meta.originalName}</dd>
            </>
          )}
          {typeof meta?.size === 'number' && (
            <>
              <dt className="text-black/50 dark:text-white/50">Size</dt>
              <dd>{(meta.size / (1024 * 1024)).toFixed(1)} MB</dd>
            </>
          )}
          {meta?.author && (
            <>
              <dt className="text-black/50 dark:text-white/50">Channel</dt>
              <dd>{meta.author}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Analysis + clips */}
      <AnalyzePanel
        projectId={project.id}
        hasVideo={Boolean((project.metadata as { storageKey?: string } | null)?.storageKey)}
        initialStatus={project.status}
        initialClips={project.clips.map((c) => ({
          id: c.id,
          title: c.title,
          hookText: c.hookText,
          startSecond: c.startSecond,
          endSecond: c.endSecond,
          score: c.score,
        }))}
      />
    </main>
  );
}
