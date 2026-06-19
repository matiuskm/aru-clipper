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
- Node.js 20+ (diimplementasikan & diuji dengan Node 24)
- PostgreSQL (local atau Supabase/Neon) — di repo ini dijalankan via Docker Compose
- Redis (local atau Upstash) — di repo ini dijalankan via Docker Compose
- Docker + Docker Compose (untuk infra lokal Postgres + Redis)
- Cloudflare account (untuk R2)
- Git

> **Catatan versi (implementasi aktual, Juni 2026):**
> - `create-next-app@latest` kini menghasilkan **Next.js 16** (bukan 15). App Router & seluruh setup di bawah tetap sama; perbedaan kecil dicatat di tiap langkah.
> - **Prisma di-pin ke v6.** Prisma 7 menghapus flow `url = env("DATABASE_URL")` di schema (wajib driver adapter + `prisma.config.ts`). Agar konsisten dengan dokumen ini, gunakan Prisma 6.
> - Di Next.js 16, konvensi `middleware.ts` diganti menjadi **`proxy.ts`** (lihat bagian Authentication).

## Langkah-langkah Detail

### 1. Project Initialization
1. Buat project Next.js dengan App Router. Di repo ini project di-scaffold langsung
   di direktori `clipper` (bukan subfolder `ai-shorts-generator`):
   ```bash
   # scaffold di direktori saat ini (folder boleh sudah berisi docs/)
   npx create-next-app@latest . --typescript --tailwind --eslint --app \
     --no-src-dir --import-alias "@/*" --no-turbopack --use-npm --yes
   ```
   > `create-next-app@latest` menghasilkan **Next.js 16** dan sekaligus menjalankan `git init`.

2. Install dependencies utama:
   ```bash
   npm install prisma@^6 @prisma/client@^6 bullmq ioredis@5.10.1 zod
   npm install @auth/prisma-adapter next-auth@beta bcryptjs
   npm install @aws-sdk/client-s3
   npm install ffmpeg-static fluent-ffmpeg  # untuk fase selanjutnya
   npm install -D concurrently tsx @types/bcryptjs @types/fluent-ffmpeg
   ```
   > **Penting:** `ioredis` di-pin ke `5.10.1` agar cocok dengan versi yang dibundel BullMQ
   > (versi berbeda memunculkan konflik tipe TypeScript pada `connection`).
   > `prisma`/`@prisma/client` di-pin ke `^6` (lihat catatan versi di atas).

3. Setup Prisma:
   ```bash
   npx prisma init
   ```

4. Buat file `.env` (lihat contoh di bawah).

5. Git sudah di-init oleh `create-next-app`. Buat commit awal setelah semua langkah selesai.

### 2. Database & Prisma

#### a. Infrastruktur lokal (Postgres + Redis via Docker)
Dokumen awal belum menyertakan perintah untuk **membuat database**. Di repo ini
Postgres & Redis dijalankan via Docker Compose, dan database dibuat otomatis.

Buat file `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: clipper-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: clipper
      POSTGRES_PASSWORD: clipper
      POSTGRES_DB: clipper        # <-- database dibuat otomatis saat container start
    ports:
      - "5433:5432"               # host 5433 -> agar tidak bentrok dgn Postgres lokal di 5432
    volumes:
      - clipper_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U clipper -d clipper"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: clipper-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - clipper_redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  clipper_pgdata:
  clipper_redisdata:
```

Jalankan infra:
```bash
docker compose up -d
```

> **Membuat database secara manual** (jika tidak pakai Docker / pakai Postgres existing):
> ```bash
> createdb clipper
> # atau via psql:
> psql -U postgres -c "CREATE DATABASE clipper;"
> ```

#### b. Prisma schema
`DATABASE_URL` untuk setup Docker di atas:
`postgresql://clipper:clipper@localhost:5433/clipper?schema=public`

> **Perubahan dari dokumen awal:** model `User` ditambah field `password` (nullable)
> untuk menyimpan hash password pada auth berbasis kredensial.

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
  password  String?  // hash password untuk credentials auth (Fase 1)
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
Menggunakan **Auth.js / NextAuth v5 (beta)** dengan **Credentials provider** + **JWT session**
(strategi paling sederhana untuk register/login lokal tanpa OAuth). Pola konfigurasi
dipecah menjadi *edge-safe config* (untuk proxy/middleware) dan *full config* (Node runtime).

> Catatan: `@auth/prisma-adapter` di-install untuk kesiapan OAuth di masa depan,
> namun **tidak diwire** di sini karena Credentials + JWT tidak memakai adapter session.

**`auth.config.ts`** (edge-safe, dipakai oleh `proxy.ts`):
```ts
import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  pages: { signIn: '/login' },
  providers: [], // provider asli ditambahkan di auth.ts (Node runtime)
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
      if (isOnDashboard) return isLoggedIn;
      return true;
    },
  },
} satisfies NextAuthConfig;
```

**`auth.ts`** (Node runtime, dengan Prisma + bcrypt):
```ts
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authConfig } from '@/auth.config';
import { prisma } from '@/lib/prisma';

const schema = z.object({ email: z.string().email(), password: z.string().min(6) });

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsed = schema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.password) return null;
        if (!(await bcrypt.compare(password, user.password))) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) { if (user) token.id = user.id; return token; },
    session({ session, token }) {
      if (token.id && session.user) session.user.id = token.id as string;
      return session;
    },
  },
});
```

**Route handler** `app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from '@/auth';
export const { GET, POST } = handlers;
```

**Registrasi** `app/api/register/route.ts`: validasi via zod, cek email duplikat,
hash password dengan `bcrypt.hash(password, 10)`, lalu `prisma.user.create`.

**Protected routes** — Next.js 16 mengganti nama `middleware.ts` menjadi **`proxy.ts`**:
```ts
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

const { auth } = NextAuth(authConfig);
export default auth;

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

Tambahkan juga augmentasi tipe di `types/next-auth.d.ts` agar `session.user.id`
dan `token.id` ter-type dengan benar.

### 4. API Structure & Configuration
Buat folder structure:

```
/app
  /api
    /auth/[...nextauth]   # handler Auth.js
    /register             # POST registrasi
    /projects             # placeholder (Fase 2)
    /clips                # placeholder (Fase 4)
    /jobs/test            # enqueue test job (validasi BullMQ)
  /dashboard              # protected route
  /login, /register       # halaman auth
/lib
  prisma.ts
  redis.ts
  queue.ts                # BullMQ queue (pengganti "bullmq.ts")
  worker.ts
  r2.ts
  ai.ts                   # placeholder (Fase 3)
/types
  next-auth.d.ts          # augmentasi tipe session/jwt
auth.ts                   # config Auth.js (Node runtime)
auth.config.ts            # config Auth.js edge-safe
proxy.ts                  # route protection (ex-middleware.ts)
docker-compose.yml        # Postgres + Redis
prisma/schema.prisma
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
  "worker": "tsx --env-file=.env lib/worker.ts",
  "dev:full": "concurrently -n next,worker -c blue,magenta \"npm run dev\" \"npm run worker\"",
  "db:push": "prisma db push",
  "db:studio": "prisma studio",
  "postinstall": "prisma generate"
}
```

> **Penting:** worker dijalankan sebagai proses tsx terpisah (bukan lewat Next.js),
> sehingga **tidak otomatis memuat `.env`**. Gunakan flag native Node `--env-file=.env`
> agar `REDIS_URL` dkk terbaca.

`concurrently` & `tsx` sudah di-install di langkah 1.2.

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
# Database (Docker Postgres di host port 5433)
DATABASE_URL="postgresql://clipper:clipper@localhost:5433/clipper?schema=public"

# Auth.js v5 membaca AUTH_SECRET; generate: openssl rand -base64 32
AUTH_SECRET=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000

# Redis (Docker)
REDIS_URL="redis://localhost:6379"

# Cloudflare R2
CLOUDFLARE_R2_ENDPOINT=...
CLOUDFLARE_R2_ACCESS_KEY=...
CLOUDFLARE_R2_SECRET_KEY=...
CLOUDFLARE_R2_BUCKET_NAME=...
CLOUDFLARE_R2_PUBLIC_DOMAIN=...

# AI providers (fase selanjutnya)
GEMINI_API_KEY=...
GROQ_API_KEY=...
```

> `.gitignore` mengabaikan `.env*`. Tambahkan pengecualian `!.env.example`
> agar template tetap ter-commit, sementara `.env` asli tetap diabaikan.

### 8. Testing & Basic Pages
- Buat halaman login/register sederhana menggunakan NextAuth
- Dashboard kosong
- Protected route test

## Hasil Akhir yang Diharapkan (Checklist)

- [x] Project Next.js (16) berjalan lancar (`npm run dev`) — build & lint hijau
- [x] Database Prisma ter-setup dan semua 5 tabel terbuat (`npm run db:push`)
- [x] Authentication berfungsi (register & login terverifikasi end-to-end)
- [x] BullMQ + Redis queue bisa dipakai (enqueue via `/api/jobs/test`, worker memproses)
- [~] R2 storage helper siap pakai (`lib/r2.ts`) — upload nyata menunggu kredensial R2 asli (diuji di Fase 2)
- [x] `.env.example` lengkap, `.env` di-gitignore (`!.env.example` dikecualikan)
- [x] Project structure rapi sesuai rekomendasi
- [x] Git repo dengan commit yang jelas
- [x] README.md yang menjelaskan cara setup project

## Validation Criteria (untuk AI Agent / Self-Check)
1. Jalankan `npm run dev` (atau `npm run dev:full` untuk app + worker) → tidak ada error
2. Bisa register user baru dan login (UI di `/register` & `/login`, atau via `curl`)
3. `npm run db:studio` (Prisma Studio) → semua tabel muncul
4. Test enqueue job BullMQ: `curl -X POST http://localhost:3000/api/jobs/test` → log worker memproses job
5. Upload test file ke R2 berhasil dan bisa diakses via URL — **butuh kredensial R2 asli** (ditunda ke Fase 2)
6. Tidak ada secret key yang commit ke git (`.env` di-gitignore)

### Status verifikasi (implementasi aktual)
- ✅ `npm run build`, `npm run lint`, `tsc --noEmit` → semua hijau
- ✅ Register (`201`), duplikat (`409`), proteksi route (`401`/redirect `307`)
- ✅ Login credentials end-to-end → session memuat `user.id`
- ✅ Enqueue `/api/jobs/test` → worker log: `Job 1 completed successfully`
- ⏳ Upload R2 menunggu kredensial bucket

---

**Setelah fase ini selesai**, beri tahu saya agar kita lanjut ke fase berikutnya (Project Management + Upload).

Semangat coding! 🚀
