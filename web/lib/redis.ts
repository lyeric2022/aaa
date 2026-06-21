import { createClient, type RedisClientType } from "redis";

// Single shared connection to the move-memory store. The arena keeps working
// without Redis (it falls back to filesystem storage), so connecting is
// best-effort: if Redis is unreachable we mark it unavailable once and stop
// retrying for the life of the process instead of stalling every request.

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const DISABLED = process.env.REDIS_DISABLED === "1";

type RedisGlobal = {
  client: RedisClientType | null;
  connecting: Promise<RedisClientType | null> | null;
  unavailable: boolean;
};

// Persist across Next.js dev hot-reloads so we don't open a socket per reload.
const globalForRedis = globalThis as unknown as { __arenaRedis?: RedisGlobal };
const state: RedisGlobal =
  globalForRedis.__arenaRedis ??
  (globalForRedis.__arenaRedis = {
    client: null,
    connecting: null,
    unavailable: false,
  });

/**
 * Returns a connected Redis client, or null when Redis is disabled or
 * unreachable. Callers should treat null as "use the filesystem fallback".
 */
export async function getRedis(): Promise<RedisClientType | null> {
  if (DISABLED || state.unavailable) return null;
  if (state.client?.isReady) return state.client;
  if (state.connecting) return state.connecting;

  state.connecting = (async () => {
    try {
      const client = createClient({
        url: REDIS_URL,
        socket: {
          connectTimeout: 1500,
          // Give up quickly: this is an optional dependency, not a hard one.
          reconnectStrategy: (retries) => (retries > 2 ? false : 200),
        },
      }) as RedisClientType;

      // Swallow errors so an unreachable Redis never crashes a request; the
      // availability flag below routes callers to the filesystem instead.
      client.on("error", () => {
        state.unavailable = true;
      });

      await client.connect();
      state.client = client;
      state.unavailable = false;
      return client;
    } catch {
      state.unavailable = true;
      return null;
    } finally {
      state.connecting = null;
    }
  })();

  return state.connecting;
}

/** True once a connection has been established this process. */
export function redisReady(): boolean {
  return Boolean(state.client?.isReady);
}
