# Phase 4: Clip Generation & FFmpeg Rendering

## Tujuan Fase Ini
Fase ini fokus pada **generasi klip otomatis** dari transkrip dan analisis highlight, serta **rendering video** menggunakan FFmpeg dengan:
- Potongan video berdasarkan start/end time
- Burn-in subtitles otomatis
- Hook text overlay
- Optimasi untuk Shorts/Reels (9:16, kualitas tinggi, cepat render)

Ini adalah fase paling teknis dan "vibe" karena banyak eksperimen visual.

> **⚠️ Catatan implementasi (status aktual, 2026-06-19):**
> Fase ini sudah diimplementasikan & diverifikasi end-to-end. Penyesuaian terhadap draft di bawah:
> 1. **Storage = lokal** (lanjutan Phase 2/3). Hasil render disimpan ke `./storage/clips/<projectId>/<clipId>.mp4` (helper `buildClipKey`/`ensureKeyPath`) dan di-serve lewat `/api/files/...` yang sudah ada (route diperluas untuk mengizinkan prefix `clips/` selain `videos/`). Bukan upload ke R2.
> 2. **Clip TIDAK di-generate ulang di Phase 4.** Clips (start/end/score/hookText) sudah dibuat oleh analisis Gemini di Phase 3. Phase 4 fokus **rendering** clip yang sudah ada — jadi `lib/clipGenerator.ts` (step 3 draft) tidak dibuat; yang ada adalah render job + endpoint render.
> 3. **`lib/ffmpeg.ts`** memakai binary `ffmpeg-static` (spawn argv array, bukan `exec` string — lebih aman dari shell injection). Render: cut `[start, start+duration]` → `scale`+`pad` ke **1080×1920 (9:16)** → opsional **hook overlay** (drawtext, pakai `textfile`+`expansion=none` biar bebas escaping, auto word-wrap) → opsional **subtitle burn-in** (filter `subtitles`/libass dari SRT). Font dideteksi dari sistem (Arial di macOS / DejaVu di Linux); kalau font tak ada, overlay/subtitle dilewati tapi cut+resize tetап jalan. Encode `libx264 -preset veryfast -crf 23`, `aac 128k`, `+faststart`.
> 4. **Subtitle** dibangun dari transcript Phase 3: segmen yang overlap window clip dipotong & di-rebase ke waktu relatif clip (`cuesForWindow`).
> 5. **Queue/worker**: job `render-clip` (`enqueueRenderClip`) di queue `video-processing` yang sama; worker dispatch by `job.name`. Clip status: `pending → rendering → completed/failed`.
> 6. **Endpoint**: `POST /api/clips/[id]/render` (1 clip) & `POST /api/projects/[id]/render` (semua clip yang belum rendering). Keduanya Auth.js v5 + cek kepemilikan (clip → project → user).
> 7. **Frontend**: `AnalyzePanel` di halaman detail diperluas — tombol "Render"/"Render ulang" per clip + "Render semua", preview `<video>` 9:16 saat `renderUrl` ada, dan polling status diperluas selama ada clip yang `rendering`.
>
> Bagian di bawah adalah draft rencana awal; baca dengan penyesuaian di atas.

## Estimasi Waktu (Vibe Coding)
**8 – 14 hari** (tergantung seberapa dalam kamu ingin perfecting FFmpeg).

## Langkah-langkah Detail

### 1. Update Prisma Schema (jika belum)
Tambahkan field yang diperlukan di `prisma/schema.prisma`:

```prisma
model Clip {
  id          String   @id @default(uuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id])
  title       String
  startSecond Int
  endSecond   Int
  score       Int      // confidence score dari AI
  hookText    String?  // generated hook
  renderUrl   String?  // URL R2 setelah render selesai
  status      String   @default("pending") // pending, rendering, completed, failed
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Project {
  // ... existing fields
  clips Clip[]
}
```

Jalankan:
```bash
npx prisma migrate dev --name add_clips_table
npx prisma generate
```

### 2. Buat Service FFmpeg Wrapper

Buat file baru: `lib/ffmpeg.ts`

```ts
// lib/ffmpeg.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export interface RenderOptions {
  inputPath: string;
  outputPath: string;
  start: number;
  duration: number;
  hookText?: string;
  subtitles?: Array<{ text: string; start: number; end: number }>;
  resolution?: '1080x1920'; // Shorts vertical
}

export async function renderShortClip(options: RenderOptions): Promise<string> {
  const {
    inputPath,
    outputPath,
    start,
    duration,
    hookText,
    subtitles = [],
    resolution = '1080x1920'
  } = options;

  // Buat temporary subtitle file jika ada
  let subtitlePath: string | null = null;
  if (subtitles.length > 0) {
    subtitlePath = path.join('/tmp', `subs_${Date.now()}.srt`);
    const srtContent = subtitles
      .map((sub, i) => `${i + 1}\n${formatTime(sub.start)} --> ${formatTime(sub.end)}\n${sub.text}`)
      .join('\n\n');
    await fs.writeFile(subtitlePath, srtContent);
  }

  let filterComplex = '';

  // Basic zoom + crop for vertical
  filterComplex = `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`;

  if (hookText) {
    filterComplex += `,drawtext=text='${hookText.replace(/'/g, "\\'")}':fontcolor=white:fontsize=48:box=1:boxcolor=black@0.5:x=(w-text_w)/2:y=100`;
  }

  if (subtitlePath) {
    filterComplex += `,subtitles='${subtitlePath}'`;
  }

  const command = `ffmpeg -ss ${start} -i "${inputPath}" -t ${duration} \
    -vf "${filterComplex}" \
    -c:v libx264 -preset medium -crf 23 \
    -c:a aac -b:a 128k \
    -movflags +faststart \
    "${outputPath}" -y`;

  try {
    await execAsync(command);
    return outputPath;
  } catch (error) {
    console.error('FFmpeg error:', error);
    throw error;
  } finally {
    if (subtitlePath) await fs.unlink(subtitlePath).catch(() => {});
  }
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}
```

### 3. Buat Clip Generation Service

Buat file: `lib/clipGenerator.ts`

```ts
// lib/clipGenerator.ts
import { Gemini } from '@/lib/gemini'; // sesuaikan import
import { prisma } from '@/lib/prisma';
import { renderShortClip } from './ffmpeg';
import { uploadToR2 } from './r2';

export async function generateClips(projectId: string, count: number = 8) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { transcripts: true }
  });

  if (!project?.transcripts?.[0]) throw new Error('Transcript not found');

  const transcript = project.transcripts[0].transcript_json as any;

  // Gunakan Gemini untuk generate highlight segments + hook
  const gemini = new Gemini();
  const prompt = `...` // (buat prompt bagus untuk extract 8-10 highlights)

  const result = await gemini.generateContent(prompt);
  const clipsData = JSON.parse(result);

  const createdClips = [];

  for (const clipData of clipsData.slice(0, count)) {
    const clip = await prisma.clip.create({
      data: {
        projectId,
        title: clipData.title,
        startSecond: clipData.start,
        endSecond: clipData.end,
        score: clipData.score,
        hookText: clipData.hookText,
        status: 'pending'
      }
    });

    // Queue rendering job
    await clipRenderQueue.add('render-clip', {
      clipId: clip.id,
      projectId,
      start: clipData.start,
      duration: clipData.end - clipData.start,
      hookText: clipData.hookText
    });

    createdClips.push(clip);
  }

  return createdClips;
}
```

### 4. BullMQ Job Processor untuk Rendering

Update atau buat worker di `lib/worker.ts`:

```ts
// Di dalam worker processor
case 'render-clip':
  const { clipId, start, duration, hookText } = job.data;
  
  const clip = await prisma.clip.findUnique({ where: { id: clipId } });
  const project = await prisma.project.findUnique({ where: { id: clip.projectId } });

  const inputPath = `/tmp/${project.id}.mp4`; // download dari R2 dulu jika perlu
  const outputPath = `/tmp/${clipId}.mp4`;

  await renderShortClip({
    inputPath,
    outputPath,
    start,
    duration,
    hookText,
    subtitles: [] // nanti diimplementasikan full
  });

  // Upload ke R2
  const renderUrl = await uploadToR2(outputPath, `clips/${clipId}.mp4`);

  await prisma.clip.update({
    where: { id: clipId },
    data: { renderUrl, status: 'completed' }
  });

  break;
```

### 5. API Routes

- `app/api/clips/generate/route.ts`
- `app/api/clips/[id]/render/route.ts`

### 6. Frontend Integration
- Tampilkan list clips di project page
- Preview menggunakan React Player
- Button "Generate Clips" yang call API

## Validation Checklist (Akhir Fase)

- [x] Clips otomatis dari satu project (dibuat di Phase 3, dirender di Phase 4)
- [x] FFmpeg render video vertikal **9:16 (1080×1920)** dengan hook text overlay
- [x] Subtitle burn-in bekerja (libass dari transcript, di-rebase per clip)
- [x] Hasil render tersimpan ke **local storage** dan `renderUrl` tercatat di DB
- [x] Job queue processing (`render-clip`) berjalan tanpa error
- [x] Bisa preview clip di frontend (tombol render + `<video>` 9:16 + polling)
- [x] Handle error gracefully (clip status → 'failed', ffmpeg stderr di-log)
- [ ] Code ter-commit

> **Hasil test E2E (8/8 passed):** login → upload → analyze (mock) sampai `completed` (3 clips) →
> 401 saat render unauth → render 1 clip (200+jobId) → render semua (queued 2, clip yang lagi rendering di-skip) →
> poll sampai semua clip `completed` (~6s) → 3 file ada di `storage/clips/<pid>/` →
> `renderUrl` ter-serve 200 & terbukti **1080×1920**, ditolak 401 saat unauth.
> **Unit:** `renderShortClip` (output 1080×1920, 3s, h264+aac) & `cuesForWindow` (rebase + clamp). Worker log bersih (4 job completed).

---

**Catatan Penting:**
- FFmpeg optimization butuh banyak trial & error. Mulai dengan preset `medium`, lalu coba `fast` atau `veryslow`.
- Untuk subtitle yang lebih bagus, gunakan library seperti `node-srt` atau generate ASS.
- Test dengan video 5–15 menit dulu.

---

File ini sudah siap. Gas lanjut bro! 🔥

Kalau sudah selesai Phase 4, kita lanjut ke **Phase 5: Polish, Testing & MVP Complete**.
