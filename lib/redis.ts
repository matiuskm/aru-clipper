// lib/redis.ts
import { Redis } from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null, // penting untuk BullMQ
});

redis.on('error', (err) => console.error('Redis Client Error', err));
