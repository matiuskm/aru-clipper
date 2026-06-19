'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Tab = 'upload' | 'youtube';

export function NewProjectForm() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('upload');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Upload state
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  // YouTube state
  const [ytUrl, setYtUrl] = useState('');
  const [ytTitle, setYtTitle] = useState('');

  function done(projectId: string) {
    router.push(`/projects/${projectId}`);
    router.refresh();
  }

  // Use XHR so we can show real upload progress (fetch can't report it).
  function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return setError('Pilih file video dulu');
    if (!title.trim()) return setError('Judul wajib diisi');

    const form = new FormData();
    form.append('video', file);
    form.append('title', title.trim());

    setLoading(true);
    setProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/projects/upload');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      setLoading(false);
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        done(JSON.parse(xhr.responseText).project.id);
      } else {
        const msg = (() => {
          try {
            return JSON.parse(xhr.responseText).error;
          } catch {
            return 'Upload gagal';
          }
        })();
        setError(msg);
      }
    };
    xhr.onerror = () => {
      setLoading(false);
      setProgress(null);
      setError('Upload gagal (network error)');
    };
    xhr.send(form);
  }

  async function handleYoutube(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ytUrl.trim()) return setError('Masukkan URL YouTube');

    setLoading(true);
    try {
      const res = await fetch('/api/projects/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ytUrl.trim(), title: ytTitle.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import gagal');
      done(data.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import gagal');
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    'w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent';
  const tabCls = (active: boolean) =>
    `flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
      active
        ? 'bg-foreground text-background'
        : 'text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10'
    }`;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-8">
      <div className="flex items-center gap-3">
        <Link href="/projects" className="text-sm text-black/60 underline dark:text-white/60">
          ← Projects
        </Link>
        <h1 className="text-2xl font-semibold">New project</h1>
      </div>

      <div className="flex gap-2 rounded-lg border border-black/10 p-1 dark:border-white/15">
        <button type="button" className={tabCls(tab === 'upload')} onClick={() => setTab('upload')}>
          Upload Local
        </button>
        <button type="button" className={tabCls(tab === 'youtube')} onClick={() => setTab('youtube')}>
          Import YouTube
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {tab === 'upload' ? (
        <form key="upload" onSubmit={handleUpload} className="space-y-4">
          <input
            className={inputCls}
            placeholder="Judul project"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            type="file"
            accept="video/*"
            className={`${inputCls} file:mr-3 file:rounded file:border-0 file:bg-black/10 file:px-3 file:py-1 dark:file:bg-white/15`}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {progress !== null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
              <div
                className="h-full bg-foreground transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-foreground px-3 py-2 font-medium text-background disabled:opacity-50"
          >
            {loading ? `Mengupload… ${progress ?? 0}%` : 'Upload & buat project'}
          </button>
        </form>
      ) : (
        <form key="youtube" onSubmit={handleYoutube} className="space-y-4">
          <input
            className={inputCls}
            placeholder="https://youtube.com/watch?v=…"
            value={ytUrl}
            onChange={(e) => setYtUrl(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="Judul (opsional — diambil dari YouTube jika kosong)"
            value={ytTitle}
            onChange={(e) => setYtTitle(e.target.value)}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-foreground px-3 py-2 font-medium text-background disabled:opacity-50"
          >
            {loading ? 'Mengimpor…' : 'Import dari YouTube'}
          </button>
        </form>
      )}
    </main>
  );
}
