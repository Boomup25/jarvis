/**
 * Rate limiting, in memory.
 *
 * Single Railway instance, so a shared Map is genuinely sufficient — no Redis,
 * no extra service. It resets on deploy, which is an acceptable trade for a
 * personal app: the point is to stop someone hammering a public URL, not to
 * survive a restart.
 */

interface Bucket {
  hits: number[];
  /** Set when a bucket is locked out; ms timestamp. */
  lockedUntil?: number;
}

const buckets = new Map<string, Bucket>();

/** Stop the Map growing without bound on a long-lived process. */
function sweep(now: number) {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    const recent = bucket.hits.some((t) => now - t < 3_600_000);
    const locked = bucket.lockedUntil && bucket.lockedUntil > now;
    if (!recent && !locked) buckets.delete(key);
  }
}

export interface LimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the caller may retry. */
  retryAfter: number;
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number; lockoutMs?: number }
): LimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key) ?? { hits: [] };
  buckets.set(key, bucket);

  if (bucket.lockedUntil && bucket.lockedUntil > now) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((bucket.lockedUntil - now) / 1000) };
  }

  bucket.hits = bucket.hits.filter((t) => now - t < opts.windowMs);

  if (bucket.hits.length >= opts.limit) {
    if (opts.lockoutMs) bucket.lockedUntil = now + opts.lockoutMs;
    const oldest = bucket.hits[0] ?? now;
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.ceil(((opts.lockoutMs ?? opts.windowMs - (now - oldest))) / 1000),
    };
  }

  bucket.hits.push(now);
  return { ok: true, remaining: opts.limit - bucket.hits.length, retryAfter: 0 };
}

/** Clears a bucket — call after a successful login so one typo isn't punished. */
export function clearLimit(key: string) {
  buckets.delete(key);
}

/**
 * Best-effort client identity. Behind Railway's proxy the socket address is
 * the proxy, so the forwarded header is what we have. It's spoofable — this
 * raises the cost of abuse, it doesn't make it impossible.
 */
export function clientKey(req: Request, scope: string): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

/** 429 with the standard header. */
export function tooMany(result: LimitResult, message: string): Response {
  return Response.json(
    { error: message, retryAfter: result.retryAfter },
    { status: 429, headers: { "Retry-After": String(Math.max(1, result.retryAfter)) } }
  );
}
