import "server-only";

import net from "node:net";

export type CacheFault = "redis-unconfigured" | "redis-unavailable" | "unsupported-driver";
export type CacheRead =
  | { state: "hit"; value: string }
  | { state: "miss" }
  | { state: "blocked"; fault: CacheFault };

export type CacheStore = {
  driver: "redis" | "memory";
  get(key: string): Promise<CacheRead>;
  set(key: string, value: string, ttlSeconds: number): Promise<"stored" | "blocked">;
  delete(key: string): Promise<void>;
};

const memoryLimit = 100;
type MemoryEntry = { value: string; expiresAt: number };

export function memoryCache(now = () => Date.now()): CacheStore {
  const entries = new Map<string, MemoryEntry>();
  function live(key: string) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return null;
    }
    return entry;
  }
  return {
    driver: "memory",
    async get(key) {
      const entry = live(key);
      return entry ? { state: "hit", value: entry.value } : { state: "miss" };
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds <= 0 || value.length > 4000) return "blocked";
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      while (entries.size > memoryLimit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return "stored";
    },
    async delete(key) {
      entries.delete(key);
    },
  };
}

function blocked(fault: CacheFault): CacheStore {
  return {
    driver: "redis",
    async get() {
      return { state: "blocked", fault };
    },
    async set() {
      return "blocked";
    },
    async delete() {
      return undefined;
    },
  };
}

function encode(parts: string[]) {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
}

function redisTarget(url: string | undefined) {
  const parsed = URL.parse(url ?? "");
  if (!parsed || parsed.protocol !== "redis:") return null;
  const port = parsed.port ? Number(parsed.port) : 6379;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !parsed.hostname) return null;
  const database = parsed.pathname.replace(/^\//, "");
  try {
    return {
      host: parsed.hostname,
      port,
      password: decodeURIComponent(parsed.password),
      database: database && database !== "0" ? database : "",
    };
  } catch {
    return null;
  }
}

function readReply(buffer: string): { value: string | null; rest: string } | null {
  if (!buffer.includes("\r\n")) return null;
  const prefix = buffer[0];
  const lineEnd = buffer.indexOf("\r\n");
  const line = buffer.slice(1, lineEnd);
  const rest = buffer.slice(lineEnd + 2);
  if (prefix === "+" || prefix === ":") return { value: line, rest };
  if (prefix === "-") throw new Error("redis-error");
  if (prefix !== "$") return null;
  const length = Number(line);
  if (!Number.isInteger(length)) return null;
  if (length < 0) return { value: null, rest };
  if (Buffer.byteLength(rest) < length + 2) return null;
  const bytes = Buffer.from(rest);
  return { value: bytes.subarray(0, length).toString(), rest: bytes.subarray(length + 2).toString() };
}

function sendRedis(url: string, command: string[]) {
  const target = redisTarget(url);
  if (!target) return Promise.reject(new Error("redis-target"));
  const commands = [
    ...(target.password ? [["AUTH", target.password]] : []),
    ...(target.database ? [["SELECT", target.database]] : []),
    command,
  ];
  return new Promise<string | null>((resolve, reject) => {
    const socket = net.connect({ host: target.host, port: target.port });
    let buffer = "";
    let index = 0;
    let settled = false;
    const timer = setTimeout(() => finish(new Error("redis-timeout")), 300);
    function finish(error?: Error, value: string | null = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    }
    socket.on("error", () => finish(new Error("redis-unavailable")));
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      try {
        while (index < commands.length) {
          const reply = readReply(buffer);
          if (!reply) return;
          buffer = reply.rest;
          index += 1;
          if (index === commands.length) finish(undefined, reply.value);
        }
      } catch {
        finish(new Error("redis-unavailable"));
      }
    });
    socket.on("connect", () => {
      for (const parts of commands) socket.write(encode(parts));
    });
  });
}

function redisCache(url: string | undefined): CacheStore {
  if (!url || !redisTarget(url)) return blocked("redis-unconfigured");
  return {
    driver: "redis",
    async get(key) {
      try {
        const value = await sendRedis(url, ["GET", key]);
        return value === null ? { state: "miss" } : { state: "hit", value };
      } catch {
        return { state: "blocked", fault: "redis-unavailable" };
      }
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds <= 0 || value.length > 4000) return "blocked";
      try {
        const reply = await sendRedis(url, ["SET", key, value, "EX", String(ttlSeconds)]);
        return reply === "OK" ? "stored" : "blocked";
      } catch {
        return "blocked";
      }
    },
    async delete(key) {
      try {
        await sendRedis(url, ["DEL", key]);
      } catch {
        // The next read compares the cached copy with the database and discards a mismatch.
      }
    },
  };
}

const processMemory = memoryCache();

export function isRedisCacheConfigured(env: NodeJS.ProcessEnv = process.env) {
  return (env.GEO_CACHE_DRIVER ?? "redis") === "redis" && redisTarget(env.REDIS_URL) !== null;
}

// Default is Redis. The process memory store is used only when the caller
// selects GEO_CACHE_DRIVER=memory on the process environment. A missing or
// unreachable Redis never falls back to that store.
export function openCache(env: NodeJS.ProcessEnv = process.env): CacheStore {
  const driver = env.GEO_CACHE_DRIVER ?? "redis";
  if (driver === "memory") return env === process.env ? processMemory : memoryCache();
  if (driver === "redis") return redisCache(env.REDIS_URL);
  return blocked("unsupported-driver");
}
