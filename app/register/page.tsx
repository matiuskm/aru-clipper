'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = form.get('email');
    const password = form.get('password');

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        email,
        password,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Gagal mendaftar');
      setLoading(false);
      return;
    }

    // Auto sign-in after successful registration.
    await signIn('credentials', { email, password, redirect: false });
    setLoading(false);
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-black/10 p-6 dark:border-white/15"
      >
        <h1 className="text-2xl font-semibold">Daftar</h1>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <input
          name="name"
          type="text"
          placeholder="Nama (opsional)"
          className="w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
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
          placeholder="Password (min. 6 karakter)"
          required
          minLength={6}
          className="w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-foreground px-3 py-2 font-medium text-background disabled:opacity-50"
        >
          {loading ? 'Memproses...' : 'Daftar'}
        </button>

        <p className="text-center text-sm text-black/60 dark:text-white/60">
          Sudah punya akun?{' '}
          <Link href="/login" className="underline">
            Masuk
          </Link>
        </p>
      </form>
    </main>
  );
}
