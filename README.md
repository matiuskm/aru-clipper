# Clipper — AI Shorts Generator

Mengubah video panjang menjadi klip pendek (shorts) secara otomatis dengan bantuan AI.

Repo ini menyelesaikan **Fase 1: Foundation & Setup** — Next.js 16 (App Router) + Prisma + PostgreSQL + BullMQ/Redis + Cloudflare R2 + Auth.js (NextAuth v5).

## Tech Stack

| Area              | Tooling                                  |
| ----------------- | ---------------------------------------- |
| Framework         | Next.js 16 (App Router) + React 19       |
| Bahasa            | TypeScript                               |
| Styling           | Tailwind CSS v4                          |
| Database / ORM    | PostgreSQL + Prisma 6                     |
| Auth              | Auth.js / NextAuth v5 (Credentials, JWT) |
| Queue             | BullMQ + Redis                           |
| Storage           | Cloudflare R2 (S3-compatible)            |
| Infra lokal       | Docker Compose (Postgres + Redis)        |

## Prerequisites

- Node.js 20+ (diuji dengan Node 24)
- Docker + Docker Compose (untuk Postgres & Redis lokal)
- Cloudflare account (untuk R2 — diperlukan di fase berikutnya)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Salin env & isi nilainya
cp .env.example .env
# Generate AUTH_SECRET:  openssl rand -base64 32

# 3. Jalankan infra lokal (Postgres :5433, Redis :6379)
docker compose up -d

# 4. Buat schema database
npm run db:push

# 5. Jalankan app + worker bersamaan
npm run dev:full
```

Buka http://localhost:3000 — daftar akun, login, dan akan diarahkan ke `/dashboard`.

> Catatan: Postgres dipetakan ke host port **5433** agar tidak bentrok dengan
> instalasi PostgreSQL lokal yang mungkin sudah berjalan di 5432.

## Scripts

| Script                | Fungsi                                            |
| --------------------- | ------------------------------------------------- |
| `npm run dev`         | Jalankan Next.js dev server                       |
| `npm run worker`      | Jalankan BullMQ worker (proses background job)    |
| `npm run dev:full`    | Jalankan dev server + worker bersamaan            |
| `npm run build`       | Production build                                  |
| `npm run db:push`     | Sinkronkan Prisma schema ke database              |
| `npm run db:studio`   | Buka Prisma Studio (GUI database)                 |
| `npm run lint`        | ESLint                                            |

## Struktur Proyek

```
/app
  /api
    /auth/[...nextauth]   # handler Auth.js
    /register            # endpoint registrasi (POST)
    /projects            # placeholder (Fase 2)
    /clips               # placeholder (Fase 4)
    /jobs/test           # enqueue test job (validasi BullMQ)
  /dashboard             # protected route
  /login, /register      # halaman auth
/lib
  prisma.ts              # Prisma client singleton
  redis.ts               # koneksi ioredis
  queue.ts               # BullMQ queue
  worker.ts              # BullMQ worker
  r2.ts                  # helper Cloudflare R2
  ai.ts                  # placeholder AI client (Fase 3)
auth.ts                  # konfigurasi Auth.js (Node runtime)
auth.config.ts           # konfigurasi Auth.js edge-safe (untuk proxy)
proxy.ts                 # route protection (Next.js 16 "proxy", ex-middleware)
prisma/schema.prisma     # skema database
docker-compose.yml       # Postgres + Redis lokal
```

## Catatan Implementasi (perbedaan dari dokumen Fase 1)

- **Next.js 16**, bukan 15 — `create-next-app@latest` kini menghasilkan v16. App Router tetap sama.
- **Prisma 6** (dipin) — Prisma 7 mengubah flow datasource (wajib driver adapter + `prisma.config.ts`); v6 mempertahankan flow `url = env("DATABASE_URL")` + `prisma db push` sesuai dokumen.
- **`proxy.ts`**, bukan `middleware.ts` — Next.js 16 mengganti nama konvensi `middleware` menjadi `proxy`.
- **`ioredis` dipin ke `5.10.1`** agar cocok dengan versi yang dibundel BullMQ (menghindari konflik tipe TypeScript).
- **Field `password`** ditambahkan ke model `User` untuk auth berbasis kredensial.
- Postgres & Redis dijalankan via Docker Compose (database `clipper` dibuat otomatis).

## R2 (Storage)

Helper `lib/r2.ts` siap pakai. Untuk mengaktifkannya, isi variabel `CLOUDFLARE_R2_*`
di `.env` dengan kredensial bucket R2 Anda. Upload akan dites di Fase 2 (saat fitur
upload video dibangun).
