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
  status: string;
  renderUrl: string | null;
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

  const anyRendering = clips.some((c) => c.status === 'rendering');
  const busy = ACTIVE.includes(status);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) return;
    const { project } = await res.json();
    setStatus(project.status);
    setClips(project.clips ?? []);
  }, [projectId]);

  // Poll while analysis is running or any clip is rendering.
  useEffect(() => {
    if (!busy && !anyRendering) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [busy, anyRendering, refresh]);

  async function post(url: string, optimistic: () => void) {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal memproses');
      optimistic();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memproses');
    } finally {
      setStarting(false);
    }
  }

  const analyze = () =>
    post(`/api/projects/${projectId}/analyze`, () => setStatus('queued'));

  const renderAll = () =>
    post(`/api/projects/${projectId}/render`, () =>
      setClips((cs) => cs.map((c) => ({ ...c, status: 'rendering' })))
    );

  const renderOne = (clipId: string) =>
    post(`/api/clips/${clipId}/render`, () =>
      setClips((cs) =>
        cs.map((c) => (c.id === clipId ? { ...c, status: 'rendering' } : c))
      )
    );

  return (
    <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-medium">Clips ({clips.length})</h2>
        <div className="flex items-center gap-3">
          {busy && <StatusBadge status={status} />}
          {clips.length > 0 && (
            <button
              onClick={renderAll}
              disabled={busy || anyRendering || starting}
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-white/20"
            >
              {anyRendering ? 'Merender…' : 'Render semua'}
            </button>
          )}
          <button
            onClick={analyze}
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
        <ul className="grid gap-3 sm:grid-cols-2">
          {clips
            .slice()
            .sort((a, b) => b.score - a.score)
            .map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/15"
              >
                {c.renderUrl ? (
                  <video
                    src={c.renderUrl}
                    controls
                    className="aspect-[9/16] w-full rounded bg-black"
                  />
                ) : (
                  <div className="flex aspect-[9/16] w-full items-center justify-center rounded bg-black/5 text-xs text-black/40 dark:bg-white/5 dark:text-white/40">
                    {c.status === 'rendering' ? 'Merender…' : 'Belum dirender'}
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{c.title}</p>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                    {c.score}
                  </span>
                </div>
                {c.hookText && (
                  <p className="text-sm text-black/60 dark:text-white/60">“{c.hookText}”</p>
                )}
                <div className="mt-auto flex items-center justify-between pt-1">
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {fmt(c.startSecond)} – {fmt(c.endSecond)} · {c.endSecond - c.startSecond}s
                  </span>
                  <button
                    onClick={() => renderOne(c.id)}
                    disabled={c.status === 'rendering' || starting}
                    className="rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/20"
                  >
                    {c.status === 'rendering'
                      ? 'Merender…'
                      : c.renderUrl
                        ? 'Render ulang'
                        : 'Render'}
                  </button>
                </div>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
