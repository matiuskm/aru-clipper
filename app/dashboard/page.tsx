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

      <p className="text-sm text-black/60 dark:text-white/60">
        🎉 Foundation siap. Fitur project & upload akan ditambahkan di Fase 2.
      </p>
    </main>
  );
}
