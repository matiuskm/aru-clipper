# Phase 3: Transcription & Analysis

## Tujuan Fase Ini
Fase ini fokus pada **core AI processing** dari sistem AI Shorts Generator:
- Mengubah audio video menjadi teks (Transcription)
- Mendeteksi bagian-bagian menarik/highlight dari video
- Menghasilkan hook text yang menarik untuk setiap clip
- Menyimpan hasil ke database

Ini adalah salah satu fase tersulit dan paling penting karena melibatkan integrasi AI (Whisper + Gemini), queue processing, dan cost optimization.

> **⚠️ Catatan implementasi (status aktual, 2026-06-19):**
> Fase ini sudah diimplementasikan dan diverifikasi end-to-end. Penyesuaian terhadap draft di bawah:
> 1. **Sumber media = local storage** (lanjutan Phase 2). Job membaca file video dari disk (`metadata.storageKey`), bukan dari URL R2. Project YouTube (tanpa file lokal) ditolak dengan 400 — download media-nya ditunda ke fase berikutnya.
> 2. **Ekstraksi audio dulu** sebelum transkripsi: `lib/media.ts` memakai binary `ffmpeg-static` (spawn langsung, tanpa ffprobe) untuk meng-extract MP3 mono 16 kHz + membaca durasi video. File audio sementara dibersihkan di `finally`.
> 3. **AI via REST, bukan SDK.** `lib/ai.ts` memanggil Groq Whisper (`/openai/v1/audio/transcriptions`) dan Gemini (`generateContent`) langsung dengan `fetch` — tidak menambah dependency `groq-sdk`/`@google/generative-ai`. Output Gemini dipaksa JSON (`responseMimeType: application/json`) lalu divalidasi & di-clamp dengan Zod (`parseHighlights`).
> 4. **Mock fallback + `AI_MOCK`.** Jika `GROQ_API_KEY`/`GEMINI_API_KEY` kosong (atau `AI_MOCK=1`), step tersebut memakai output mock deterministik. Saat ini key Groq belum diisi (transkrip = mock), key Gemini aktif (analisis = real). Ini bikin pipeline bisa dites offline & gratis.
> 5. **Model Gemini default `gemini-2.5-flash`** (override via `GEMINI_MODEL`). Draft memakai `gemini-1.5-flash` yang sudah retired untuk API key ini — diganti.
> 6. **Satu queue.** Memakai queue `video-processing` yang sudah ada dengan job name `analyze` (`enqueueAnalyze()`), bukan queue terpisah `analyze`. Worker dispatch berdasarkan `job.name`, `concurrency: 2`.
> 7. **Idempotent.** Di awal job, transcript & clip lama untuk project itu dihapus, jadi retry BullMQ / re-analyze tidak menumpuk duplikat.
> 8. **Auth & ownership** di route trigger (`POST /api/projects/[id]/analyze`) memakai Auth.js v5 + cek kepemilikan, plus status `queued` sebelum di-enqueue. Frontend: tombol "Analyze & Generate Clips" + polling status + daftar clips di halaman detail project.
> 9. **Status flow aktual:** `queued → transcribing → analyzing → completed` (atau `failed`).
>
> Bagian di bawah adalah draft rencana awal; baca dengan penyesuaian di atas.

## Estimasi Waktu (Vibe Coding)
**8 – 14 hari** (tergantung seberapa dalam kamu ingin eksperimen dengan prompt Gemini).

## Persiapan Sebelum Mulai
Pastikan Phase 1 dan Phase 2 sudah selesai:
- Redis + BullMQ berjalan
- Project + Video upload ke R2 sudah berfungsi
- Prisma schema sudah ada (transcripts & clips table)

## Langkah-langkah Detail

### 1. Update Prisma Schema
Tambahkan field yang diperlukan.

Buka `prisma/schema.prisma` dan tambahkan/update model berikut:

```prisma
model Transcript {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  transcriptJson Json     // Array of {time, text, speaker?}
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("transcripts")
}

model Clip {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  title       String
  startSecond Int
  endSecond   Int
  score       Int      // confidence score 0-100
  hookText    String?  // AI generated hook
  renderUrl   String?
  status      String   @default("pending") // pending, processing, completed, failed
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("clips")
}
```

Jalankan:
```bash
npx prisma migrate dev --name add_transcript_and_clip
npx prisma generate
```

### 2. Setup AI Services (lib/ai.ts)

Buat file baru `lib/ai.ts`:

```ts
import { Groq } from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function transcribeAudio(audioUrl: string): Promise<any> {
  // Untuk sekarang pakai Groq Whisper (lebih cepat & murah)
  const response = await groq.audio.transcriptions.create({
    file: await fetch(audioUrl).then(r => r.blob()), // atau download dulu
    model: "whisper-large-v3",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  return response.segments.map((seg: any) => ({
    start: Math.floor(seg.start),
    end: Math.floor(seg.end),
    text: seg.text.trim(),
  }));
}

export async function analyzeHighlights(transcript: any[], videoDuration: number) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // atau pro untuk hasil lebih baik

  const prompt = `
  Kamu adalah expert video editor untuk YouTube Shorts / TikTok.
  Analisis transcript berikut dan berikan 5-10 highlight terbaik.

  Transcript:
  ${JSON.stringify(transcript)}

  Video duration: ${videoDuration} seconds.

  Berikan output JSON array dengan format:
  [
    {
      "start": number,
      "end": number,
      "score": number (0-100),
      "title": "judul singkat clip",
      "hook": "hook text yang sangat menarik (max 15 kata)"
    }
  ]

  Rules:
  - Clip duration antara 15 - 60 detik
  - Prioritaskan momen emosional, surprising, insightful, atau viral potential
  - Jangan overlap clip terlalu banyak
  `;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse Gemini response", text);
    return [];
  }
}
```

### 3. Buat Job Processor untuk Analysis

Buat file `lib/jobs/analyze-job.ts`:

```ts
import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { r2Client } from '@/lib/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { transcribeAudio, analyzeHighlights } from '@/lib/ai';
import { queue } from '@/lib/queue';

export async function processAnalyzeJob(job: Job) {
  const { projectId } = job.data;
  
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project?.videoUrl) throw new Error("Video URL not found");

    // 1. Transcribe
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'transcribing' }
    });

    const transcript = await transcribeAudio(project.videoUrl);

    await prisma.transcript.create({
      data: {
        projectId,
        transcriptJson: transcript,
      }
    });

    // 2. Analyze Highlights
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'analyzing' }
    });

    const highlights = await analyzeHighlights(transcript, project.duration || 300);

    // 3. Save Clips
    for (const highlight of highlights) {
      await prisma.clip.create({
        data: {
          projectId,
          title: highlight.title,
          startSecond: highlight.start,
          endSecond: highlight.end,
          score: highlight.score,
          hookText: highlight.hook,
          status: 'pending'
        }
      });
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'completed' }
    });

  } catch (error) {
    console.error("Analyze Job Failed:", error);
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'failed' }
    });
    throw error;
  }
}
```

### 4. Integrasikan ke Worker

Update `lib/worker.ts`:

```ts
import { Worker } from 'bullmq';
import { connection } from './queue';
import { processAnalyzeJob } from './jobs/analyze-job';

const worker = new Worker('analyze', processAnalyzeJob, { 
  connection,
  concurrency: 2 // sesuaikan dengan budget AI
});

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});
```

### 5. API Route untuk Trigger Analysis

Buat `app/api/projects/[id]/analyze/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { queue } from '@/lib/queue';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const projectId = params.id;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  await queue.add('analyze', { projectId });

  return NextResponse.json({ success: true, message: "Analysis job queued" });
}
```

### 6. Frontend Integration (Sederhana)
Di halaman `/projects/[id]`, tambahkan tombol:
```tsx
<button onClick={async () => {
  await fetch(`/api/projects/${id}/analyze`, { method: 'POST' });
  // refresh data
}}>
  Analyze & Generate Clips
</button>
```

Gunakan polling atau WebSocket (nanti di fase selanjutnya) untuk update status.

## Validation Checklist (Akhir Fase)

- [x] Prisma schema Transcript & Clip di-update (`hookText`, `status`, `updatedAt`, `onDelete: Cascade`) & pushed
- [x] `lib/ai.ts` berfungsi: transcribe (Groq, +mock) dan analyze (Gemini real, +mock) — divalidasi Zod
- [x] `lib/media.ts` ekstraksi audio + durasi via ffmpeg-static
- [x] Job `analyze` diproses via BullMQ (queue `video-processing`, worker concurrency 2)
- [x] Transcript tersimpan di database sebagai JSON
- [x] Clip otomatis terbuat dengan start, end, score, dan hookText
- [x] Status project berubah benar (queued → transcribing → analyzing → completed)
- [x] Error handling bekerja (status jadi 'failed' jika error; job idempotent saat retry)
- [x] Trigger dari frontend (tombol + polling) dan hasil tersimpan di DB
- [ ] Code ter-commit

> **Hasil test E2E:**
> - **Pipeline penuh (AI_MOCK=1, deterministik) — 8/8 passed:** login → upload video (ada audio) →
>   401 saat unauth → trigger analyze (200 + jobId) → poll sampai `completed` (~4s) →
>   3 clips dengan hookText+score → DB berisi transcript (6 segmen) + 3 clips →
>   analyze project YouTube ditolak 400.
> - **Real Gemini lewat worker:** project selesai `completed` dengan clips ter-generate dari API live
>   (`gemini-2.5-flash`). Catatan: Gemini sempat balas `503 UNAVAILABLE` (overload sementara) saat run pertama —
>   transient, bukan bug; retry berhasil.
> - **Unit:** `extractAudio`/`getDuration` (6s, mp3 ~49KB), `parseHighlights` (strip fence + clamp).

## Catatan Penting
- Gunakan **Gemini 1.5 Flash** untuk development (lebih cepat & murah).
- Test dengan video pendek (3-10 menit) dulu.
- Monitor biaya AI — Whisper + Gemini bisa mahal kalau sering test.
- Prompt Gemini sangat penting — kamu bisa improve prompt ini nanti.

---

**File ini sudah siap.**  
Silakan download dan kerjakan.

Setelah Phase 3 selesai, kita lanjut ke **Phase 4: Clip Generation & FFmpeg Rendering**.

Mau saya ubah atau tambahkan sesuatu di file ini dulu?  
Contoh: tambah error handling lebih detail, contoh prompt Gemini yang lebih advanced, atau integrasi Whisper local? 

Langsung gas atau ada revisi bro? 🚀