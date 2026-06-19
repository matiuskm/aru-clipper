# Phase 5: Polish, Testing, Error Handling & MVP Complete

## Tujuan Fase Ini
Fase terakhir ini fokus untuk menyelesaikan aplikasi menjadi **MVP yang usable**, stabil, dan siap dicoba. 
Kita akan membersihkan code, menambahkan error handling yang baik, progress tracking, testing, dan memastikan seluruh flow dari upload sampai download MP4 berjalan lancar.

**Estimasi Waktu (Vibe Coding):** 5 – 10 hari

> **⚠️ Catatan implementasi (status aktual, 2026-06-19):**
> Banyak item Phase 5 sudah tercicil di fase sebelumnya. Yang ditambahkan/diselesaikan di fase ini:
> 1. **Error message ke user**: kolom `errorMessage` di `Project` & `Clip`; job mengisi pesan ramah (`lib/error.ts` memetakan Groq 429 / Gemini 503 / ffmpeg dll ke teks Indonesia). Ditampilkan di UI: banner merah saat analisis gagal + pesan per-clip yang gagal.
> 2. **Download MP4**: route `/api/files` mendukung `?download=1` (Content-Disposition attachment); tombol **Download** per clip di UI.
> 3. **Progress tracking**: stepper 4 tahap + spinner + timer elapsed (dibuat di iterasi sebelumnya), polling sadar-render.
> 4. **Error handling robust**: retry transient AI (Gemini 429/500/503) in-call, BullMQ backoff 10s/20s, transcript di-reuse agar retry tidak membakar kuota Groq, status `failed` + pesan.
> 5. **Validasi env** (`lib/env.ts`, Zod): `DATABASE_URL`/`REDIS_URL`/`AUTH_SECRET` wajib; AI key opsional (warning, ada mock fallback). Dipanggil saat worker start.
> 6. **README** diperbarui jadi panduan MVP lengkap (run lokal, env, alur pemakaian, arsitektur).
> 7. **Cost/perf**: Gemini Flash (`gemini-2.5-flash`), transcript cache/reuse, ffmpeg `-preset veryfast`, audio 16kHz mono untuk Whisper.
>
> Belum dikerjakan (di luar scope MVP / opsional): rate limiting (upstash), unit test suite formal (Jest/Supertest) — verifikasi dilakukan lewat skrip E2E manual tiap fase, tabel `ApiKey` (BYOK) masih placeholder.

## Langkah-langkah Detail

### 1. Progress Tracking & Job Status
- Tambahkan field `processingStatus` dan `progress` di tabel `projects` dan `clips`.
- Buat API endpoint untuk realtime progress (SSE atau polling).
- Update BullMQ job processor untuk report progress.

**Contoh update Prisma Schema:**
```prisma
model Project {
  // ... existing fields
  status          String    @default("pending") // pending, analyzing, generating, rendering, completed, failed
  progress        Int       @default(0) // 0-100
  errorMessage    String?
  updatedAt       DateTime  @updatedAt
}

model Clip {
  // ... existing
  status          String    @default("pending")
  progress        Int       @default(0)
  errorMessage    String?
}
```

### 2. Error Handling yang Robust
- Buat custom error classes.
- Implement retry mechanism di BullMQ (default 3-5 retries).
- Centralized error logging.
- User-friendly error messages di frontend.

**Contoh di worker:**
```ts
// lib/error.ts
export class ProcessingError extends Error {
  constructor(message: string, public code: string, public recoverable = true) {
    super(message);
  }
}

// Di job processor
try {
  // process
} catch (error) {
  if (error instanceof ProcessingError && error.recoverable) {
    throw error; // BullMQ akan retry
  }
  // log error
}
```

### 3. Frontend Polish
- Tambahkan loading states, progress bar di project detail page.
- Clip preview dengan React Player.
- Download button untuk MP4.
- Error toast notifications (sonner atau shadcn toast).
- Responsive design improvement.
- Dark mode support (jika belum).

### 4. Testing
- **Unit Test**: API routes utama, FFmpeg wrapper, Gemini prompt.
- **Integration Test**: Full flow dengan video test (5-10 menit).
- **Manual Testing**:
  - Upload video lokal
  - Import YouTube
  - Generate transcript
  - Generate 5-10 clips
  - Render dengan subtitle + hook
  - Download & cek kualitas

**Rekomendasi tools testing:**
- Jest + Testing Library (frontend)
- Supertest (API)
- Video test files di folder `/test-videos`

### 5. Performance & Cost Optimization
- Limit durasi video di MVP (max 30-60 menit).
- Gunakan Gemini Flash untuk highlight detection (lebih murah).
- Cache transcript jika memungkinkan.
- FFmpeg optimization (preset, CRF, hardware acceleration jika di server).

### 6. Security & Production Readiness
- Rate limiting (upstash atau next-rate-limit).
- File size validation.
- Sanitize user input.
- Environment variable validation (zod).
- Basic logging (Pino atau Winston).

### 7. MVP Completion Checklist
- [x] User bisa upload video lokal
- [x] User bisa import dari YouTube (metadata; analisis menyusul untuk YouTube)
- [x] Transcript berhasil dibuat (Whisper, word-level)
- [x] Highlight detection & clip generation (5–10 clips, Gemini)
- [x] Auto subtitles (burned-in) + hook text
- [x] Rendering MP4 berhasil (9:16, blur bg)
- [x] Download clip (`?download=1`)
- [x] Progress tracking terlihat (stepper + timer)
- [x] Error handling graceful (errorMessage + retry)
- [x] UI/UX cukup baik untuk demo
- [ ] Code ter-commit

> **Smoke test E2E (mock):** upload → analyze (`completed`) → render semua
> (`completed`) → header download benar (`attachment` saat `?download=1`, inline tanpa).
> tsc & eslint bersih.

## Hasil Akhir yang Diharapkan
1. Aplikasi bisa dipakai end-to-end tanpa crash fatal.
2. User mendapatkan 5–10 short clips berkualitas dari satu video panjang.
3. Codebase bersih, mudah di-maintain.
4. Dokumentasi sederhana (README.md) untuk run locally & deploy.
5. Siap untuk demo atau early testing.

## Validation Criteria (bisa dicek sendiri atau AI)
- Buka `/projects/new`, upload video → berhasil dibuat project.
- Klik Analyze → progress bergerak sampai selesai.
- Di project detail muncul list clips dengan preview.
- Bisa download MP4 dan video playable dengan subtitle + hook text.
- Tidak ada error console yang mengganggu.
- Job queue tidak stuck (cek Redis dashboard jika pakai).

---

**Selamat!**  
Kalau fase ini selesai, berarti **MVP AI Shorts Generator** kamu sudah jadi.

Mau saya buatkan:
- README.md lengkap untuk project?
- Deployment guide ke Vercel + Cloudflare?
- Atau rencana Phase 6 (Post-MVP features)?

Kasih tahu bro! 🔥
