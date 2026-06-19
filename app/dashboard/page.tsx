import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';

export default async function DashboardPage() {
  const session = await auth();

  // Defense in depth — middleware already gates /dashboard.
  if (!session?.user) redirect('/login');

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button
            type="submit"
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
          >
            Keluar
          </button>
        </form>
      </header>

      <section className="rounded-xl border border-black/10 p-6 dark:border-white/15">
        <p className="text-sm text-black/60 dark:text-white/60">Masuk sebagai</p>
        <p className="text-lg font-medium">{session.user.email}</p>
        <p className="mt-2 text-sm text-black/50 dark:text-white/50">
          User ID: {session.user.id}
        </p>
      </section>

      <Link
        href="/projects"
        className="rounded-xl border border-black/10 p-6 transition hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
      >
        <p className="font-medium">Projects →</p>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Upload video lokal atau import dari YouTube, lalu kelola project kamu.
        </p>
      </Link>
    </main>
  );
}
