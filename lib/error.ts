// lib/error.ts
// Map raw processing errors to short, user-friendly messages (Indonesian).

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (/Groq transcription failed \(429\)|rate_limit_exceeded/i.test(msg)) {
    return 'Kuota transkripsi (Groq) habis untuk sementara. Coba lagi dalam ~20 menit.';
  }
  if (/Groq transcription failed/i.test(msg)) {
    return 'Gagal mentranskripsi audio (Groq). Periksa GROQ_API_KEY atau coba lagi.';
  }
  if (/Gemini analysis failed \(429\)/i.test(msg)) {
    return 'Kuota analisis (Gemini) habis sementara. Coba lagi nanti.';
  }
  if (/Gemini analysis failed \(50\d\)|UNAVAILABLE/i.test(msg)) {
    return 'Layanan AI (Gemini) sedang sibuk. Coba Analyze ulang sebentar lagi.';
  }
  if (/Gemini analysis failed/i.test(msg)) {
    return 'Gagal menganalisis highlight (Gemini). Periksa GEMINI_API_KEY atau coba lagi.';
  }
  if (/ffmpeg/i.test(msg)) {
    return 'Gagal merender video (ffmpeg). Video mungkin rusak atau format tidak didukung.';
  }
  if (/No local video|Source video/i.test(msg)) {
    return 'File video sumber tidak ditemukan.';
  }
  // Fallback: keep it short.
  return msg.length > 160 ? msg.slice(0, 157) + '…' : msg;
}
