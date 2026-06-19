# Phase 2: Project Management & Video Upload

## Tujuan Fase Ini
Membangun sistem manajemen proyek dasar dan fitur upload video (baik lokal maupun dari YouTube). Pada akhir fase ini, user sudah bisa:
- Membuat project baru
- Upload video lokal ke Cloudflare R2
- Import video dari YouTube URL
- Melihat daftar project
- Melihat detail project (termasuk status dan video preview)

Ini adalah fondasi untuk processing pipeline selanjutnya.

## Estimasi Waktu (Vibe Coding)
**5 – 8 hari** (tergantung pengalaman dengan file upload dan yt-dlp).

## Persiapan Sebelum Mulai
Pastikan Phase 1 (Foundation & Setup) sudah selesai dan berjalan dengan baik:
- Next.js 15 App Router
- Prisma + PostgreSQL terhubung
- Auth sudah aktif
- Redis + BullMQ sudah setup
- Cloudflare R2 terkonfigurasi (R2 client)

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
2. Bisa membuat project baru via upload lokal → file tersimpan di R2, record di DB.
3. Bisa import dari YouTube URL → project tercatat.
4. API endpoints berfungsi dan return data sesuai.
5. Status project ter-update dengan benar (`pending`, `uploading`, `uploaded`, dll).

## Validation Checklist

- [ ] Prisma schema `Project` sudah terupdate dan migrate berhasil
- [ ] GET /api/projects mengembalikan list project user
- [ ] POST /api/projects/upload berhasil simpan video ke R2 dan DB
- [ ] POST /api/projects/youtube berhasil buat project
- [ ] Frontend form upload dan import berfungsi
- [ ] Video URL di R2 bisa diakses (public)
- [ ] Error handling dasar sudah ada
- [ ] Semua code ter-commit dengan baik

---

**Catatan Penting:**
- Untuk MVP, prioritaskan upload lokal. YouTube import bisa di-simplify dulu.
- Jangan download full video YouTube di server (bisa mahal dan lambat). Gunakan direct URL dulu.
- Siapkan error logging yang baik.

Setelah fase ini selesai, beri tahu saya untuk lanjut ke **Phase 3: Transcription & Analysis**.