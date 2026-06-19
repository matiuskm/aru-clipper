'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@/components/status-badge';

interface Clip {
  id: string;
  title: string;
  hookText: string | null;
  startSecond: number;
  endSecond: number;
  score: number;
}

const ACTIVE = ['queued', 'transcribing', 'analyzing'];

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AnalyzePanel({
  projectId,
  hasVideo,
  initialStatus,
  initialClips,
}: {
  projectId: string;
  hasVideo: boolean;
  initialStatus: string;
  initialClips: Clip[];
}) {
  const [status, setStatus] = useState(initialStatus);
  const [clips, setClips] = useState<Clip[]>(initialClips);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) return;
    const { project } = await res.json();
    setStatus(project.status);
    setClips(project.clips ?? []);
  }, [projectId]);

  // Poll while the pipeline is running, stop once it settles.
  useEffect(() => {
    if (!ACTIVE.includes(status)) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [status, refresh]);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/analyze`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memulai analisis');
      setStatus('queued');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memulai analisis');
    } finally {
      setStarting(false);
    }
  }

  const busy = ACTIVE.includes(status);

  return (
    <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-medium">Clips ({clips.length})</h2>
        <div className="flex items-center gap-3">
          {busy && <StatusBadge status={status} />}
          <button
            onClick={start}
            disabled={!hasVideo || busy || starting}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
            title={hasVideo ? '' : 'Hanya untuk video yang sudah diupload'}
          >
            {busy
              ? 'Memproses…'
              : clips.length > 0
                ? 'Analyze ulang'
                : 'Analyze & Generate Clips'}
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {busy && (
        <p className="mb-3 text-sm text-black/60 dark:text-white/60">
          {status === 'transcribing'
            ? 'Mentranskripsi audio…'
            : status === 'analyzing'
              ? 'Menganalisis highlight…'
              : 'Menunggu antrian…'}
        </p>
      )}

      {clips.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">
          {hasVideo
            ? 'Belum ada clips. Jalankan analisis untuk membuatnya.'
            : 'Clips hanya tersedia untuk video yang diupload (Phase berikutnya: import YouTube).'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {clips
            .slice()
            .sort((a, b) => b.score - a.score)
            .map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-black/10 p-3 dark:border-white/15"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{c.title}</p>
                    {c.hookText && (
                      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                        “{c.hookText}”
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                    {c.score}
                  </span>
                </div>
                <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                  {fmt(c.startSecond)} – {fmt(c.endSecond)} · {c.endSecond - c.startSecond}s
                </p>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
