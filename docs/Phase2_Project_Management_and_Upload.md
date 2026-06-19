# Phase 2: Project Management & Video Upload

## Tujuan Fase Ini
Membangun sistem manajemen proyek dasar dan fitur upload video (baik lokal maupun dari YouTube). Pada akhir fase ini, user sudah bisa:
- Membuat project baru
- Upload video lokal (disimpan ke **local storage** — pengganti Cloudflare R2 untuk saat ini)
- Import video dari YouTube URL
- Melihat daftar project
- Melihat detail project (termasuk status dan video preview)

Ini adalah fondasi untuk processing pipeline selanjutnya.

> **⚠️ Catatan implementasi (status aktual, 2026-06-19):**
> Fase ini sudah diimplementasikan dengan beberapa penyesuaian terhadap rencana awal. Yang berbeda dari draft di bawah:
> 1. **Storage**: memakai **filesystem lokal** (`lib/storage.ts`) sebagai pengganti Cloudflare R2. File disimpan di `./storage/videos/<projectId>/...` dan di-serve lewat route terproteksi `GET /api/files/[...key]` (mendukung HTTP Range untuk streaming `<video>`). Swap ke R2 nanti cukup mengganti `lib/storage.ts` + route file-serving. `lib/r2.ts` (sudah ada) dibiarkan untuk fase migrasi.
> 2. **Auth**: memakai **Auth.js v5** (`import { auth } from '@/auth'`), bukan `getServerSession()` dari next-auth v4. Pola: `const session = await auth(); if (!session?.user) ...`.
> 3. **YouTube import**: di-simplify tanpa `yt-dlp`. Metadata (judul + thumbnail + channel) diambil via endpoint **oEmbed publik** YouTube (`https://www.youtube.com/oembed`), tanpa API key dan tanpa download video. Project disimpan dengan `status: 'pending'`; download/stream media asli ke storage ditunda ke worker (fase berikutnya).
> 4. **Schema**: `Project.id` memakai `cuid()` (konsisten dengan model lain), ada kolom `metadata Json?` dan `updatedAt`. `videoUrl` menyimpan URL relatif `/api/files/...`.
> 5. **UI**: memakai **Tailwind biasa** mengikuti gaya halaman login/register yang sudah ada (shadcn/ui belum terpasang di project ini).
> 6. **Next.js 16**: route handler dinamis memakai `RouteContext<'/path'>` dan `params` berupa Promise (`const { id } = await ctx.params`). Auth check dilakukan per-route/page (belum ada `middleware.ts`).
>
> Bagian di bawah adalah draft rencana awal; baca dengan penyesuaian di atas.

## Estimasi Waktu (Vibe Coding)
**5 – 8 hari** (tergantung pengalaman dengan file upload dan yt-dlp).

## Persiapan Sebelum Mulai
Pastikan Phase 1 (Foundation & Setup) sudah selesai dan berjalan dengan baik:
- Next.js 15 App Router
- Prisma + PostgreSQL terhubung
- Auth sudah aktif
- Redis + BullMQ sudah setup
- ~~Cloudflare R2 terkonfigurasi~~ → diganti **local storage** (`lib/storage.ts`) untuk fase ini; tidak perlu kredensial R2

## Langkah-langkah Detail

### 1. Update Prisma Schema
Tambahkan atau pastikan model `projects` sesuai spec.

```prisma
// prisma/schema.prisma
model Project {
  id          String   @id @default(uuid())
  userId      String
  title       String
  sourceType  String   // "upload" | "youtube"
  sourceUrl   String?
  videoUrl    String?  // URL di R2 setelah upload
  status      String   @default("pending") // pending, processing, completed, failed
  metadata    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [userId], references: [id])
  transcripts Transcript[]
  clips       Clip[]

  @@map("projects")
}
```

Jalankan:
```bash
npx prisma db push
npx prisma generate
```

### 2. Buat API Routes untuk Projects

#### 2.1 GET /api/projects (Daftar Project)
```ts
// app/api/projects/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    include: { clips: true }
  });

  return NextResponse.json(projects);
}
```

#### 2.2 POST /api/projects (Create Project)
```ts
// app/api/projects/route.ts
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title, sourceType, sourceUrl } = await req.json();

  const project = await prisma.project.create({
    data: {
      userId: session.user.id,
      title,
      sourceType,
      sourceUrl,
      status: 'pending'
    }
  });

  return NextResponse.json(project);
}
```

### 3. Video Upload Handler (Lokal)

#### 3.1 Install Dependencies (jika belum)
```bash
npm install @aws-sdk/client-s3
```

#### 3.2 R2 Upload Utility
```ts
// lib/r2.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function uploadToR2(file: File, projectId: string): Promise<string> {
  const fileExtension = file.name.split('.').pop();
  const key = `videos/${projectId}/${Date.now()}-${file.name}`;

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    Body: file.stream(),
    ContentType: file.type,
  });

  await s3Client.send(command);

  const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
  return publicUrl;
}
```

#### 3.3 API Upload
```ts
// app/api/projects/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { uploadToR2 } from '@/lib/r2';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('video') as File;
  const title = formData.get('title') as string;

  // ... auth check ...

  const project = await prisma.project.create({
    data: { title, sourceType: 'upload', userId: user.id, status: 'uploading' }
  });

  try {
    const videoUrl = await uploadToR2(file, project.id);
    
    await prisma.project.update({
      where: { id: project.id },
      data: { videoUrl, status: 'uploaded' }
    });

    // Queue analysis job (akan dibuat di fase selanjutnya)
    // await addAnalysisJob(project.id);

    return NextResponse.json(project);
  } catch (error) {
    await prisma.project.update({ where: { id: project.id }, data: { status: 'failed' } });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
```

### 4. YouTube Import

#### 4.1 Install yt-dlp
```bash
npm install yt-dlp-exec
```

#### 4.2 YouTube Handler
```ts
// app/api/projects/youtube/route.ts
import { NextRequest, NextResponse } from 'next/server';
import ytdl from 'yt-dlp-exec';

export async function POST(req: NextRequest) {
  const { url, title } = await req.json();

  // ... auth + create project ...

  try {
    // Download info dulu
    const info = await ytdl(url, { dumpSingleJson: true });

    const project = await prisma.project.create({
      data: {
        title: title || info.title,
        sourceType: 'youtube',
        sourceUrl: url,
        videoUrl: info.url, // atau download ke R2 nanti
        status: 'downloading'
      }
    });

    // Untuk MVP, simpan URL langsung dulu (streaming). 
    // Download full video ke R2 bisa dilakukan di worker nanti.

    return NextResponse.json(project);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to import YouTube' }, { status: 500 });
  }
}
```

### 5. Frontend Pages

#### 5.1 /projects/new
Buat form sederhana dengan dua tab: Upload Local & Import YouTube.

#### 5.2 /dashboard atau /projects
Tampilkan list project dengan card (title, status, thumbnail jika ada, created date).

Gunakan shadcn/ui components: Card, Button, Input, Progress, dll.

### 6. Error Handling & Progress
- Tambahkan loading state di frontend
- Gunakan toast untuk notifikasi
- Handle file size limit (misal max 500MB untuk MVP)

## Hasil Akhir yang Diharapkan

1. User bisa login dan melihat dashboard project.
2. Bisa membuat project baru via upload lokal → file tersimpan di local storage (`./storage`), record di DB.
3. Bisa import dari YouTube URL → project tercatat.
4. API endpoints berfungsi dan return data sesuai.
5. Status project ter-update dengan benar (`pending`, `uploading`, `uploaded`, dll).

## Validation Checklist

- [x] Prisma schema `Project` sudah terupdate dan migrate berhasil (`metadata`, `updatedAt`, default status)
- [x] GET /api/projects mengembalikan list project user (+ `_count.clips`)
- [x] POST /api/projects (create metadata) + validasi Zod
- [x] GET /api/projects/[id] detail + DELETE (hapus record & file di disk)
- [x] POST /api/projects/upload berhasil simpan video ke **local storage** dan DB
- [x] POST /api/projects/youtube berhasil buat project (metadata via oEmbed)
- [x] Frontend form upload (dengan progress bar) dan import berfungsi
- [x] Video bisa diakses & di-stream lewat `/api/files/...` (terproteksi per-user, Range support)
- [x] Ownership isolation: user lain tidak bisa baca project/file orang lain (404)
- [x] Error handling dasar sudah ada (validasi, status `failed`, limit 500MB)
- [ ] Semua code ter-commit dengan baik

> **Hasil test E2E (18/18 passed):** register/login (Auth.js credentials flow), 401 saat unauth,
> create + validasi 400, upload mp4 nyata → file tertulis di disk → status `uploaded`,
> serve file via Range (206) + tolak unauth (401), YouTube import (judul terambil dari oEmbed) +
> tolak URL non-YouTube (400), detail, cross-user 404, list count, DELETE (record + file terhapus).

---

**Catatan Penting:**
- Untuk MVP, prioritaskan upload lokal. YouTube import bisa di-simplify dulu.
- Jangan download full video YouTube di server (bisa mahal dan lambat). Gunakan direct URL dulu.
- Siapkan error logging yang baik.

Setelah fase ini selesai, beri tahu saya untuk lanjut ke **Phase 3: Transcription & Analysis**.