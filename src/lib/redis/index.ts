import type { RedisClient } from "./types";
import { env } from "@/env";

/**
 * Singleton pattern for Redis client
 * This prevents creating multiple connections in serverless environments
 * where function instances might be reused across invocations
 */
let redisClient: RedisClient | null = null;

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
 * Create a mock Redis client for development when Upstash is not configured
 */
function createMockRedisClient(): RedisClient {
  return {
    get: async () => null,
    set: async () => "OK",
    del: async () => 1,
    publish: async () => 1,
    scan: async () => ({ cursor: "0", keys: [] }),
    hget: async () => null,
    hset: async () => 1,
    hdel: async () => 1,
    hgetall: async () => null,
    hexists: async () => 0,
  };
}

/**
 * Create a Redis client for Upstash Redis.
 * Note: This should not be imported directly. Use the `getRedis`
 * function to retrieve the cached client instead.
 * @returns {RedisClient} Redis client for Upstash Redis
 */
export async function createUpstashRedisClient(): Promise<RedisClient> {
  // Dynamically import Upstash Redis only in production
  // This reduces bundle size for development and improves cold starts
  const { Redis: UpstashRedis } = await import("@upstash/redis");
  const upstash = new UpstashRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  // Adapter pattern: Create a unified interface over the Upstash implementation
  const client: RedisClient = {
    get: (key) => upstash.get(key),
    set: (key, value, options) => upstash.set(key, value, options),
    del: (key) => upstash.del(key),
    publish: (channel, message) => upstash.publish(channel, message),
    scan: async (cursor, options) => {
      const q = await upstash.scan(cursor, options);

      return {
        cursor: q[0],
        keys:
          typeof q[1]?.[0] === "string"
            ? (q[1] as string[])
            : (q[1] as { key: string; type: string }[]).map((k) => k.type),
      };
    },
    hget: (key, field) => upstash.hget(key, field),
    hset: (key, field, value) => upstash.hset(key, { [field]: value }),
    hdel: (key, field) => upstash.hdel(key, field),
    hgetall: (key) => upstash.hgetall(key),
    hexists: (key, field) => upstash.hexists(key, field),
  };

  return client;
}

/**
 * Get the Redis client based on the environment.
 * In production, it uses Upstash Redis; in development/testing, it uses a mock if Upstash is not configured.
 * This function caches the client to avoid creating multiple connections.
 * @returns {Promise<RedisClient>} The Redis client instance
 */
export async function getRedis(): Promise<RedisClient> {
  // Return existing client if already initialized
  if (redisClient) return redisClient;

  // In development/testing, use mock if Upstash is not properly configured
  if (env.NODE_ENV !== "production" && !hasValidUpstashCredentials()) {
    console.warn(
      "Using mock Redis client for development. Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for real Redis functionality.",
    );
    redisClient = createMockRedisClient();
    return redisClient;
  }

  redisClient = await createUpstashRedisClient();
  return redisClient;
}
