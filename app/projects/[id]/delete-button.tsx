'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm('Hapus project ini? Tindakan ini tidak bisa dibatalkan.')) return;
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/projects');
      router.refresh();
    } else {
      setLoading(false);
      alert('Gagal menghapus project');
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 disabled:opacity-50 dark:border-red-500/40 dark:text-red-400"
    >
      {loading ? 'Menghapus…' : 'Hapus'}
    </button>
  );
}
