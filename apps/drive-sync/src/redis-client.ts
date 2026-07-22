import { Redis } from "ioredis";
import { config } from "./config.js";

// Shared by rate limiting (rate-limit-redis) and BullMQ job locking (src/jobs).
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
