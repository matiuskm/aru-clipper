# Fase 1: Foundation & Setup

## Tujuan Fase Ini
Fase ini bertujuan membangun **fondasi teknis yang solid** untuk AI Shorts Generator agar seluruh proyek bisa dikembangkan dengan cepat, scalable, dan mudah di-maintain.

**Goals utama:**
- Project structure yang clean dan modern (Next.js 15 App Router)
- Authentication & Authorization dasar
- Database connection + ORM (Prisma)
- Background job queue (BullMQ + Redis) — **lengkap dengan worker**
- Storage (Cloudflare R2) integration
- Environment variables & configuration yang aman
- Development environment yang nyaman (Docker opsional tapi direkomendasikan)

## Estimasi Waktu (Vibe Coding)
**4 – 6 hari** (bisa lebih cepat dengan bantuan AI, tergantung pengalaman dengan queue system)

## Prerequisites
- Node.js 20+
- PostgreSQL (local atau Supabase/Neon)
- Redis (local atau Upstash)
- Cloudflare account (untuk R2)
- Git

## Langkah-langkah Detail

### 1. Project Initialization
1. Buat project Next.js 15 dengan App Router:
   ```bash
   npx create-next-app@latest ai-shorts-generator --typescript --tailwind --eslint --app --yes
   cd ai-shorts-generator
   ```

2. Install dependencies utama:
   ```bash
   npm install prisma @prisma/client bullmq ioredis zod
   npm install -D prisma
   npm install @auth/prisma-adapter next-auth@beta bcryptjs
   npm install @aws-sdk/client-s3
   npm install ffmpeg-static fluent-ffmpeg  # untuk fase selanjutnya
   ```

3. Setup Prisma:
   ```bash
   npx prisma init
   ```

4. Buat file `.env` (lihat contoh di bawah)

5. Initialize Git dan commit awal.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  projects  Project[]
  apiKeys   ApiKey[]
}

model ApiKey {
  id          String   @id @default(cuid())
  userId      String
  provider    String
  encryptedKey String
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id])
}

model Project {
  id          String    @id @default(cuid())
  userId      String
  title       String
  sourceType  String    // "upload" | "youtube"
  sourceUrl   String?
  videoUrl    String?
  status      String    // "pending" | "analyzing" | "completed" dll
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id])
  transcripts Transcript[]
  clips       Clip[]
}

model Transcript {
  id          String   @id @default(cuid())
  projectId   String
  transcriptJson Json
  createdAt   DateTime @default(now())
  project     Project  @relation(fields: [projectId], references: [id])
}

model Clip {
  id          String   @id @default(cuid())
  projectId   String
  title       String
  startSecond Int
  endSecond   Int
  score       Int
  renderUrl   String?
  createdAt   DateTime @default(now())
  project     Project  @relation(fields: [projectId], references: [id])
}
```

Jalankan:
```bash
npx prisma generate
npx prisma db push
```

### 3. Authentication
- Setup NextAuth.js / Auth.js (v5 beta)
- Buat route `/api/auth/[...nextauth]`
- Protected routes menggunakan middleware atau server component

### 4. API Structure & Configuration
Buat folder structure:

```
/app
  /api
    /projects
    /auth
    /clips
  /dashboard
  /projects
/lib
  /prisma.ts
  /bullmq.ts
  /r2.ts
  /ai.ts
/utils
```

### 5. Background Queue Setup (BullMQ + Redis)

**Penjelasan:**
BullMQ adalah queue system berbasis Redis yang powerful untuk background jobs (transcription, analysis, rendering). Kita akan setup satu Queue utama untuk processing video.

#### a. Redis Connection
Buat file `lib/redis.ts`:

```ts
// lib/redis.ts
import { Redis } from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null, // penting untuk BullMQ
});

redis.on('error', (err) => console.error('Redis Client Error', err));
```

#### b. BullMQ Queue Setup
Buat file `lib/queue.ts`:

```ts
// lib/queue.ts
import { Queue } from 'bullmq';
import { redis } from './redis';

export const videoProcessingQueue = new Queue('video-processing', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: { count: 5 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
});
```

#### c. Worker Setup
Buat file `lib/worker.ts`:

```ts
// lib/worker.ts
import { Worker } from 'bullmq';
import { redis } from './redis';
import { videoProcessingQueue } from './queue';

export const videoWorker = new Worker(
  'video-processing',
  async (job) => {
    console.log(`Processing job ${job.id} with data:`, job.data);
    
    // TODO: Logic processing akan ditambahkan di fase selanjutnya
    // Contoh: transcription, highlight detection, dll.
    
    return { success: true, message: 'Job completed' };
  },
  { connection: redis }
);

videoWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

videoWorker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err);
});
```

#### d. Start Worker
Di file `package.json`, tambahkan script:

```json
"scripts": {
  "dev": "next dev",
  "worker": "tsx lib/worker.ts",   // atau node jika pakai JS
  "dev:full": "concurrently \"npm run dev\" \"npm run worker\""
}
```

Install `concurrently` jika mau:

```bash
npm install -D concurrently tsx
```

Untuk production nanti, worker akan dijalankan terpisah (bisa pakai PM2 atau Docker).

### 6. Cloudflare R2 Integration
Install `@aws-sdk/client-s3` (sudah dilakukan di atas).

Buat helper `lib/r2.ts` (contoh sederhana):

```ts
// lib/r2.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY!,
  },
});

export async function uploadToR2(fileBuffer: Buffer, fileName: string, contentType: string) {
  const key = `videos/${Date.now()}-${fileName}`;
  
  await r2Client.send(new PutObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME!,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  }));

  return `https://${process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN}/${key}`;
}
```

### 7. Environment Variables
Buat `.env.example`:

```env
DATABASE_URL="postgresql://..."
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
REDIS_URL=...
CLOUDFLARE_R2_ENDPOINT=...
CLOUDFLARE_R2_ACCESS_KEY=...
CLOUDFLARE_R2_SECRET_KEY=...
GEMINI_API_KEY=...
GROQ_API_KEY=...
```

### 8. Testing & Basic Pages
- Buat halaman login/register sederhana menggunakan NextAuth
- Dashboard kosong
- Protected route test

## Hasil Akhir yang Diharapkan (Checklist)

- [ ] Project Next.js 15 berjalan lancar (`npm run dev`)
- [ ] Database Prisma ter-setup dan semua tabel terbuat
- [ ] Authentication berfungsi (bisa register & login)
- [ ] BullMQ + Redis queue sudah bisa dipakai (bisa enqueue & process job sederhana)
- [ ] R2 storage helper sudah bisa upload file dan generate public URL
- [ ] `.env.example` lengkap dan `.env` di-gitignore
- [ ] Project structure rapi sesuai rekomendasi
- [ ] Git repo dengan commit yang jelas
- [ ] README.md yang menjelaskan cara setup project

## Validation Criteria (untuk AI Agent / Self-Check)
1. Jalankan `npm run dev` → tidak ada error
2. Bisa register user baru dan login
3. `npx prisma studio` → semua tabel muncul
4. Test enqueue job BullMQ berhasil
5. Upload test file ke R2 berhasil dan bisa diakses via URL
6. Tidak ada secret key yang commit ke git

---

**Setelah fase ini selesai**, beri tahu saya agar kita lanjut ke fase berikutnya (Project Management + Upload).

Semangat coding! 🚀
