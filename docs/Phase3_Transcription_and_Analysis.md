# Phase 3: Transcription & Analysis

## Tujuan Fase Ini
Fase ini fokus pada **core AI processing** dari sistem AI Shorts Generator:
- Mengubah audio video menjadi teks (Transcription)
- Mendeteksi bagian-bagian menarik/highlight dari video
- Menghasilkan hook text yang menarik untuk setiap clip
- Menyimpan hasil ke database

Ini adalah salah satu fase tersulit dan paling penting karena melibatkan integrasi AI (Whisper + Gemini), queue processing, dan cost optimization.

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

- [ ] Prisma schema untuk Transcript & Clip sudah di-migrate
- [ ] `lib/ai.ts` berfungsi (bisa transcribe dan analyze)
- [ ] Job `analyze` berhasil diproses via BullMQ
- [ ] Transcript tersimpan di database sebagai JSON
- [ ] 5–10 clip otomatis terbuat dengan start, end, score, dan hookText
- [ ] Status project berubah dengan benar (transcribing → analyzing → completed)
- [ ] Error handling bekerja (project status jadi 'failed' jika error)
- [ ] Bisa trigger dari frontend dan melihat hasilnya di database

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