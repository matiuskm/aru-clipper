'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const res = await signIn('credentials', {
      email: form.get('email'),
      password: form.get('password'),
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError('Email atau password salah');
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-black/10 p-6 dark:border-white/15"
      >
        <h1 className="text-2xl font-semibold">Masuk</h1>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          className="w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-foreground px-3 py-2 font-medium text-background disabled:opacity-50"
        >
          {loading ? 'Memproses...' : 'Masuk'}
        </button>

        <p className="text-center text-sm text-black/60 dark:text-white/60">
          Belum punya akun?{' '}
          <Link href="/register" className="underline">
            Daftar
          </Link>
        </p>
      </form>
    </main>
  );
}
