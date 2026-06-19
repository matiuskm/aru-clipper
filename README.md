# Clipper — AI Shorts Generator

Mengubah video panjang menjadi klip pendek (shorts) **9:16** secara otomatis: upload video → transkrip → AI memilih highlight → render clip vertikal dengan hook + subtitle burned-in → download.

Status: **MVP lengkap (Fase 1–5)**.

## Fitur

- Auth (register/login, Credentials + JWT)
- Buat project: **upload video lokal** atau **import YouTube** (metadata via oEmbed)
- **Transkripsi** audio (Groq Whisper) — timestamp per-kata
- **Deteksi highlight** (Google Gemini) → 5–10 clip dengan judul, hook, & score
- **Render** clip 9:16 (1080×1920): background blur, hook overlay, subtitle burned-in
- Progress real-time (stepper + timer), download MP4, error message yang jelas
- Pemrosesan async via BullMQ + Redis worker

## Tech Stack

| Area           | Tooling                                  |
| -------------- | ---------------------------------------- |
| Framework      | Next.js 16 (App Router) + React 19       |
| Bahasa         | TypeScript                               |
| Styling        | Tailwind CSS v4                          |
| Database / ORM | PostgreSQL + Prisma 6                     |
| Auth           | Auth.js / NextAuth v5 (Credentials, JWT) |
| Queue          | BullMQ + Redis                           |
| AI             | Groq Whisper (transkrip) + Gemini (analisis) |
| Media          | ffmpeg (via `ffmpeg-static`)             |
| Storage        | **Local filesystem** (`./storage`) — R2-ready |
| Infra lokal    | Docker Compose (Postgres + Redis)        |

> **Storage**: MVP menyimpan file di `./storage` dan menyajikannya lewat route
> terproteksi `/api/files/...` (mendukung HTTP Range + download). `lib/r2.ts`
> disiapkan untuk migrasi ke Cloudflare R2 nanti — cukup ganti `lib/storage.ts`.

## Prerequisites

- Node.js 20+ (diuji dengan Node 24)
- Docker + Docker Compose (Postgres & Redis lokal)
- API key (opsional tapi disarankan): **Groq** (transkrip) & **Gemini** (analisis).
  Tanpa key, langkah tersebut memakai output **mock** (set `AI_MOCK=1` untuk paksa mock).

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Salin env & isi nilainya
cp .env.example .env
#    - AUTH_SECRET: openssl rand -base64 32
#    - GROQ_API_KEY & GEMINI_API_KEY (opsional; kosong = mock)

# 3. Jalankan infra lokal (Postgres :5433, Redis :6379)
docker compose up -d

# 4. Buat schema database
npm run db:push

# 5. Jalankan app + worker bersamaan (WAJIB pakai dev:full!)
npm run dev:full
```

Buka http://localhost:3000 — daftar, login, lalu buka **Projects → New project**.

> ⚠️ **Selalu pakai `npm run dev:full`**, bukan `npm run dev`. Tanpa worker,
> job analisis/render akan nyangkut di status `queued` selamanya.

## Alur Pemakaian

1. **Projects → New project** → tab **Upload Local** (atau Import YouTube).
2. Di halaman project, klik **Analyze & Generate Clips** → status berjalan
   `queued → transcribing → analyzing → completed`.
3. Setelah clips muncul, klik **Render** (per clip) atau **Render semua**.
4. Saat selesai, preview di tempat atau klik **Download**.

> Catatan: analisis/render saat ini hanya untuk video **upload**. Project YouTube
> baru menyimpan metadata (download media-nya menyusul).

## Scripts

| Script              | Fungsi                                         |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Next.js dev server saja                        |
| `npm run worker`    | BullMQ worker saja                             |
| `npm run dev:full`  | dev server + worker bersamaan (disarankan)     |
| `npm run build`     | Production build                               |
| `npm run db:push`   | Sinkronkan Prisma schema ke database           |
| `npm run db:studio` | Prisma Studio (GUI database)                   |
| `npm run lint`      | ESLint                                         |

## Environment Variables

Lihat `.env.example`. Yang penting:

| Var                  | Wajib | Keterangan                              |
| -------------------- | ----- | --------------------------------------- |
| `DATABASE_URL`       | ✅    | Postgres (Docker default port 5433)     |
| `REDIS_URL`          | ✅    | Redis untuk BullMQ                      |
| `AUTH_SECRET`        | ✅    | `openssl rand -base64 32`               |
| `GROQ_API_KEY`       | —     | Transkrip Whisper; kosong = mock        |
| `GEMINI_API_KEY`     | —     | Analisis highlight; kosong = mock       |
| `GEMINI_MODEL`       | —     | Default `gemini-2.5-flash`              |
| `STORAGE_DIR`        | —     | Default `./storage`                     |
| `AI_MOCK`            | —     | `1` = paksa mock transkrip + analisis   |

## Arsitektur Singkat

```
app/
  api/
    projects/            # CRUD project, upload, youtube, [id]/analyze, [id]/render
    clips/[id]/render    # render satu clip
    files/[...key]       # serve file dari storage (auth + range + download)
  projects/              # list, new (form), [id] (detail + AnalyzePanel)
lib/
  storage.ts   # storage lokal (pengganti R2)
  ai.ts        # Groq Whisper + Gemini (REST) + mock fallback
  media.ts     # ekstraksi audio + durasi (ffmpeg)
  ffmpeg.ts    # render clip 9:16 (blur bg + hook + subtitle ASS)
  queue.ts     # BullMQ queue + enqueue helpers
  worker.ts    # dispatch job: analyze / render-clip
  jobs/        # analyze-job, render-clip-job
  error.ts     # pesan error user-friendly
  env.ts       # validasi env
prisma/schema.prisma     # User, Project, Transcript, Clip, ApiKey
docker-compose.yml       # Postgres + Redis
```

Detail tiap fase ada di `docs/Phase*.md`.
