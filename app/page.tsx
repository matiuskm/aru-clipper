import Link from 'next/link';
import { auth } from '@/auth';

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">Clipper</h1>
        <p className="max-w-md text-black/60 dark:text-white/60">
          AI Shorts Generator — ubah video panjang menjadi klip pendek yang menarik.
        </p>
      </div>

      <div className="flex gap-3">
        {session?.user ? (
          <Link
            href="/dashboard"
            className="rounded-md bg-foreground px-5 py-2.5 font-medium text-background"
          >
            Buka Dashboard
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-md bg-foreground px-5 py-2.5 font-medium text-background"
            >
              Masuk
            </Link>
            <Link
              href="/register"
              className="rounded-md border border-black/15 px-5 py-2.5 font-medium dark:border-white/20"
            >
              Daftar
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
