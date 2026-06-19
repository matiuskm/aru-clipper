// lib/ai.ts
//
// AI integrations for transcription (Groq Whisper) and highlight analysis
// (Google Gemini), called over REST so we don't pull in vendor SDKs.
//
// Both functions fall back to a deterministic MOCK when their API key is
// missing or when AI_MOCK=1 is set. This keeps the full processing pipeline
// runnable/testable offline and avoids burning credits during development.

import { readFile } from 'fs/promises';
import path from 'path';
import { z } from 'zod';

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Highlight {
  start: number;
  end: number;
  score: number;
  title: string;
  hook: string;
}

const FORCE_MOCK = process.env.AI_MOCK === '1';
const GROQ_MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export const groqEnabled = () => !FORCE_MOCK && !!process.env.GROQ_API_KEY;
export const geminiEnabled = () => !FORCE_MOCK && !!process.env.GEMINI_API_KEY;

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/** Transcribe an audio file into timestamped segments. */
export async function transcribeAudio(audioPath: string): Promise<Segment[]> {
  if (!groqEnabled()) {
    console.warn('[ai] GROQ_API_KEY not set — using mock transcript');
    return mockTranscript();
  }

  const buf = await readFile(audioPath);
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(buf)], { type: 'audio/mpeg' }),
    path.basename(audioPath)
  );
  form.append('model', GROQ_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Groq transcription failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    segments?: Array<{ start: number; end: number; text: string }>;
  };
  return (data.segments ?? []).map((s) => ({
    start: Math.floor(s.start),
    end: Math.ceil(s.end),
    text: s.text.trim(),
  }));
}

// ---------------------------------------------------------------------------
// Highlight analysis
// ---------------------------------------------------------------------------

const highlightSchema = z.object({
  start: z.number(),
  end: z.number(),
  score: z.number(),
  title: z.string(),
  hook: z.string(),
});

function buildPrompt(transcript: Segment[], durationSec: number): string {
  return `Kamu adalah expert video editor untuk YouTube Shorts / TikTok.
Analisis transcript berikut dan berikan 5-10 highlight terbaik.

Transcript (JSON, detik):
${JSON.stringify(transcript)}

Durasi video: ${durationSec} detik.

Kembalikan HANYA JSON array dengan format:
[{ "start": number, "end": number, "score": number (0-100), "title": "judul singkat", "hook": "hook text menarik (max 15 kata)" }]

Aturan:
- Durasi tiap clip antara 15-60 detik (kecuali video lebih pendek; sesuaikan).
- Prioritaskan momen emosional, mengejutkan, insightful, atau berpotensi viral.
- Hindari overlap antar clip.
- start/end harus dalam rentang 0..${durationSec}.
- PENTING: clip harus berisi pemikiran/kalimat yang UTUH. "start" = "start" dari segmen
  tempat ide dimulai; "end" = "end" dari segmen tempat kalimat/ide itu SELESAI.
  Jangan memotong di tengah kalimat — pastikan kalimat terakhir tuntas.`;
}

/**
 * Snap a clip's boundaries to transcript segment edges so we don't cut mid-word
 * or mid-sentence. start → start of the segment it falls in; end → end of the
 * segment that contains/extends past the requested end (with a small tail pad).
 */
export function snapToSegments(
  h: Highlight,
  segments: Segment[],
  durationSec: number,
  tailPad = 0.4
): Highlight {
  if (segments.length === 0) return h;

  // Start: the segment that contains h.start, else the nearest segment start <= h.start.
  const startSeg =
    [...segments].reverse().find((s) => s.start <= h.start) ?? segments[0];
  // End: the segment that contains h.end, else the last segment ending after h.start.
  const endSeg =
    segments.find((s) => s.end >= h.end && s.start <= h.end) ??
    [...segments].reverse().find((s) => s.start < h.end) ??
    startSeg;

  const start = Math.max(0, Math.floor(startSeg.start));
  const end = Math.min(durationSec || h.end, Math.ceil(endSeg.end + tailPad));
  return { ...h, start, end: Math.max(start + 1, end) };
}

/** Analyze a transcript and return scored highlight clips. */
export async function analyzeHighlights(
  transcript: Segment[],
  durationSec: number
): Promise<Highlight[]> {
  if (!geminiEnabled()) {
    console.warn('[ai] GEMINI_API_KEY not set — using mock highlights');
    return mockHighlights(transcript, durationSec);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(transcript, durationSec) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini analysis failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Align AI boundaries to transcript segments so speech isn't cut mid-sentence.
  return parseHighlights(text, durationSec).map((h) =>
    snapToSegments(h, transcript, durationSec)
  );
}

/** Parse + sanitize the model's JSON output into valid Highlights. */
export function parseHighlights(raw: string, durationSec: number): Highlight[] {
  // Strip ```json fences if the model added them despite the JSON mime type.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[ai] Failed to parse highlight JSON:', raw.slice(0, 300));
    return [];
  }

  const arr = z.array(highlightSchema).safeParse(parsed);
  if (!arr.success) return [];

  return arr.data
    .map((h) => {
      const start = Math.max(0, Math.min(Math.floor(h.start), durationSec));
      const end = Math.max(start + 1, Math.min(Math.ceil(h.end), durationSec || h.end));
      return {
        start,
        end,
        score: Math.max(0, Math.min(100, Math.round(h.score))),
        title: h.title.slice(0, 200),
        hook: h.hook.slice(0, 200),
      };
    })
    .filter((h) => h.end > h.start);
}

// ---------------------------------------------------------------------------
// Mocks (offline development / testing)
// ---------------------------------------------------------------------------

function mockTranscript(): Segment[] {
  const lines = [
    'Selamat datang, hari ini kita bahas sesuatu yang mengubah cara saya bekerja.',
    'Banyak orang mengira produktivitas itu soal bekerja lebih keras.',
    'Padahal kuncinya adalah fokus pada satu hal yang paling penting.',
    'Saya pernah gagal total sampai akhirnya menemukan sistem ini.',
    'Dan hasilnya benar-benar di luar dugaan saya.',
    'Coba terapkan satu tips ini besok, lalu lihat bedanya.',
  ];
  return lines.map((text, i) => ({ start: i * 10, end: i * 10 + 9, text }));
}

function mockHighlights(transcript: Segment[], durationSec: number): Highlight[] {
  const total = durationSec || (transcript.at(-1)?.end ?? 30);
  const span = Math.max(15, Math.min(60, Math.round(total / 3)));
  const out: Highlight[] = [];
  for (let i = 0; i < 3; i++) {
    const start = Math.min(i * span, Math.max(0, total - span));
    const end = Math.min(start + span, total);
    if (end <= start) break;
    out.push({
      start,
      end,
      score: 90 - i * 10,
      title: `Highlight ${i + 1}`,
      hook: transcript[i]?.text?.slice(0, 80) ?? `Momen menarik #${i + 1}`,
    });
  }
  return out;
}
