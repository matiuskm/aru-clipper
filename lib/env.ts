// lib/env.ts
// Lightweight env validation. Required vars throw; AI keys only warn (we have
// mock fallbacks so the app still runs without them).

import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
});

let validated = false;

export function validateEnv() {
  if (validated) return;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid/missing environment variables: ${missing}`);
  }
  if (!process.env.GROQ_API_KEY) {
    console.warn('[env] GROQ_API_KEY not set — transcription will use mock output.');
  }
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[env] GEMINI_API_KEY not set — highlight analysis will use mock output.');
  }
  validated = true;
}
