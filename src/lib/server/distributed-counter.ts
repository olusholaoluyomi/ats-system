// distributed fixed-window counter backed by Upstash Redis's REST API - chosen
// because it works over plain HTTP from any serverless/edge function, unlike
// a normal Redis client which needs a long-lived TCP connection this platform
// doesn't offer between invocations.
//
// configured via UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Vercel's
// Upstash marketplace integration sets both automatically). when either is
// missing, or a call fails (network blip, Upstash outage), every function
// here returns null rather than throwing - callers fall back to their own
// local in-memory counter, so this backend is strictly additive: the rate
// limiters work exactly as before this module existed when it isn't
// configured, and gain cross-instance correctness once it is.
//
// this is what actually closes the "in-memory limiter doesn't survive
// multiple serverless instances" gap: without it, each Vercel instance keeps
// its own counters, so the real-world cap is a multiple of the configured
// limit rather than a hard ceiling.

import { Redis } from '@upstash/redis';

let client: Redis | null | undefined; // undefined = not yet resolved this instance

function getClient(env: Record<string, string | undefined>): Redis | null {
	if (client !== undefined) return client;
	const url = env.UPSTASH_REDIS_REST_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN;
	client = url && token ? new Redis({ url, token }) : null;
	return client;
}

// true when the distributed backend is configured for this deploy, purely
// for observability (e.g. the admin rate-limit-stats endpoint) - does not
// itself prove the backend is currently reachable.
export function isDistributedConfigured(env: Record<string, string | undefined>): boolean {
	return getClient(env) !== null;
}

export interface DistributedWindowResult {
	count: number;
	retryAfterSec: number;
}

// atomically increments `key` and, on the first increment in a window, sets
// it to expire after windowMs - true fixed-window semantics, matching the
// in-memory fallback each caller keeps for when this returns null. unlike
// the local Map's check-then-increment (which skips incrementing once
// already over the limit), INCR happens unconditionally here: peeking before
// incrementing isn't atomic/race-safe across concurrent instances, and an
// ever-growing counter past the limit is the standard, safe behaviour for a
// Redis-backed fixed window (the same approach @upstash/ratelimit itself
// uses) - it does not change whether a request is allowed, only how far past
// the limit the stored count climbs while the window stays open.
export async function distributedIncrement(
	env: Record<string, string | undefined>,
	key: string,
	windowMs: number
): Promise<DistributedWindowResult | null> {
	const redis = getClient(env);
	if (!redis) return null;
	try {
		const count = await redis.incr(key);
		if (count === 1) {
			await redis.pexpire(key, windowMs);
			return { count, retryAfterSec: Math.ceil(windowMs / 1000) };
		}
		const pttl = await redis.pttl(key);
		const ttlMs = pttl > 0 ? pttl : windowMs;
		return { count, retryAfterSec: Math.ceil(ttlMs / 1000) };
	} catch {
		return null;
	}
}

// test-only: forces the client to be re-resolved from env on the next call.
export function _resetDistributedCounterClientForTests(): void {
	client = undefined;
}
