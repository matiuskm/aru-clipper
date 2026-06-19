import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { StatusBadge } from '@/components/status-badge';

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { clips: true } } },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            {projects.length} project{projects.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/projects/new"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          + New project
        </Link>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 p-12 text-center dark:border-white/20">
          <p className="text-black/60 dark:text-white/60">Belum ada project.</p>
          <Link href="/projects/new" className="mt-2 inline-block text-sm underline">
            Buat project pertama
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => {
            const thumb = (p.metadata as { thumbnail?: string } | null)?.thumbnail;
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="block overflow-hidden rounded-xl border border-black/10 transition hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
                >
                  <div className="flex aspect-video items-center justify-center bg-black/5 dark:bg-white/5">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-3xl">🎬</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="line-clamp-2 font-medium">{p.title}</h2>
                      <StatusBadge status={p.status} />
                    </div>
                    <p className="text-xs text-black/50 dark:text-white/50">
                      {p.sourceType === 'youtube' ? 'YouTube' : 'Upload'} ·{' '}
                      {p._count.clips} clips · {p.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
