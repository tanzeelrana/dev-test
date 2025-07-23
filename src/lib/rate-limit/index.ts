import { Ratelimit as UpstashRatelimit } from "@upstash/ratelimit";
import { Redis as UpstashRedis } from "@upstash/redis";
import type { RedisClient } from "@/lib/redis/types";
import type { RateLimiter } from "./types";
import { env } from "@/env";

let upstash: UpstashRedis | null = null;
let rateLimiter: RateLimiter | null = null;

/**
 * Check if Upstash Redis credentials are properly configured
 */
function hasValidUpstashCredentials(): boolean {
  return !!(
    env.UPSTASH_REDIS_REST_URL &&
    env.UPSTASH_REDIS_REST_TOKEN &&
    env.UPSTASH_REDIS_REST_URL !== "https://www.upstash_url.com" &&
    env.UPSTASH_REDIS_REST_TOKEN !== "upstash_api_key"
  );
}

/**
 * Create a mock rate limiter for development when Upstash is not properly configured
 */
function createMockRateLimiter(): RateLimiter {
  return {
    limit: async () => ({
      success: true,
      limit: 100,
      remaining: 99,
      reset: Date.now() + 60000,
    }),
  };
}

export async function getRateLimiter(
  redis: RedisClient,
  opts: { limit: number; windowSec: number },
): Promise<RateLimiter> {
  // If we already have a rate limiter instance, return it
  if (rateLimiter) {
    return rateLimiter;
  }

  // In development/testing, use mock if Upstash is not properly configured
  if (env.NODE_ENV !== "production" && !hasValidUpstashCredentials()) {
    console.warn(
      "Using mock rate limiter for development. Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for real rate limiting.",
    );
    rateLimiter = createMockRateLimiter();
    return rateLimiter;
  }

  // If we already have an Upstash Redis instance, use it
  upstash =
    upstash ??
    new UpstashRedis({
      url: env.UPSTASH_REDIS_REST_URL!,
      token: env.UPSTASH_REDIS_REST_TOKEN!,
    });

  // Otherwise, create a new rate limiter instance,
  // cache and return it
  rateLimiter = new UpstashRatelimit({
    redis: upstash,
    limiter: UpstashRatelimit.slidingWindow(opts.limit, `${opts.windowSec}s`),
    analytics: true,
    prefix: "ratelimit",
  });

  return rateLimiter;
}
