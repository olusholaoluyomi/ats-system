// per-IP rate limiter for /api/analyze.
//
// tries the Upstash-backed distributed counter first (see
// $lib/server/distributed-counter) so the limit holds across every Vercel
// instance; when that isn't configured (or a call to it fails), falls back
// to the original per-instance in-memory Maps below. the local counters stay
// as the always-available floor - upgrade path: swap them for a different
// backend without changing the public API.

import { distributedIncrement, isDistributedConfigured } from '$lib/server/distributed-counter';

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const dailyLimits = new Map<string, { count: number; resetAt: number }>();
const MAX_RPM = 10;
const MAX_RPD = 200;
const MAX_MAP_SIZE = 10_000;
// throttle the O(n) cleanup so we don't pay it on every request once size > 10k.
// at 50k unique users/day the daily map exceeds the threshold continuously, and
// without throttling each request would walk the entire map. running it at most
// once per CLEANUP_INTERVAL_MS bounds the cost regardless of size
const CLEANUP_INTERVAL_MS = 30_000;
let lastMinuteCleanupAt = 0;
let lastDailyCleanupAt = 0;

// in-memory counters surfaced by /api/admin/rate-limit-stats. zero storage,
// per-instance only (lost on cold start), but enough to spot abuse patterns
// in the hot loop without paying for any external observability service.
const stats = {
	totalChecks: 0,
	totalAllowed: 0,
	totalBlockedMinute: 0,
	totalBlockedDaily: 0,
	startedAt: Date.now()
};

export type RateLimitResult =
	{ allowed: true } | { allowed: false; reason: 'minute' | 'daily'; retryAfterSec: number };

// the original per-instance check, unchanged - used whenever the distributed
// backend isn't configured or a call to it failed.
function checkRateLimitLocal(ip: string): RateLimitResult {
	const now = Date.now();

	// periodically clean up expired entries to prevent unbounded memory growth.
	// throttled so the O(n) sweep can't fire on every request when the map sits
	// above MAX_MAP_SIZE (which becomes steady-state at high traffic)
	if (rateLimits.size > MAX_MAP_SIZE && now - lastMinuteCleanupAt > CLEANUP_INTERVAL_MS) {
		for (const [key, val] of rateLimits) {
			if (now > val.resetAt) rateLimits.delete(key);
		}
		lastMinuteCleanupAt = now;
	}
	if (dailyLimits.size > MAX_MAP_SIZE && now - lastDailyCleanupAt > CLEANUP_INTERVAL_MS) {
		for (const [key, val] of dailyLimits) {
			if (now > val.resetAt) dailyLimits.delete(key);
		}
		lastDailyCleanupAt = now;
	}

	// check both windows BEFORE incrementing, so a daily-limit failure
	// doesn't also consume a minute slot
	const minute = rateLimits.get(ip);
	if (minute && now < minute.resetAt && minute.count >= MAX_RPM) {
		return {
			allowed: false,
			reason: 'minute',
			retryAfterSec: Math.ceil((minute.resetAt - now) / 1000)
		};
	}

	const day = dailyLimits.get(ip);
	if (day && now < day.resetAt && day.count >= MAX_RPD) {
		return {
			allowed: false,
			reason: 'daily',
			retryAfterSec: Math.ceil((day.resetAt - now) / 1000)
		};
	}

	// both windows have headroom - increment both
	if (minute && now < minute.resetAt) minute.count++;
	else rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });

	if (day && now < day.resetAt) day.count++;
	else dailyLimits.set(ip, { count: 1, resetAt: now + 86_400_000 });

	return { allowed: true };
}

export async function checkRateLimit(
	env: Record<string, string | undefined>,
	ip: string
): Promise<RateLimitResult> {
	stats.totalChecks += 1;

	const [minute, day] = await Promise.all([
		distributedIncrement(env, `rl:analyze:m:${ip}`, 60_000),
		distributedIncrement(env, `rl:analyze:d:${ip}`, 86_400_000)
	]);

	let result: RateLimitResult;
	if (minute !== null && day !== null) {
		if (minute.count > MAX_RPM) {
			result = { allowed: false, reason: 'minute', retryAfterSec: minute.retryAfterSec };
		} else if (day.count > MAX_RPD) {
			result = { allowed: false, reason: 'daily', retryAfterSec: day.retryAfterSec };
		} else {
			result = { allowed: true };
		}
	} else {
		result = checkRateLimitLocal(ip);
	}

	if (result.allowed) stats.totalAllowed += 1;
	else if (result.reason === 'minute') stats.totalBlockedMinute += 1;
	else stats.totalBlockedDaily += 1;

	return result;
}

// observability surface for /api/admin/rate-limit-stats. returns the
// in-process counters plus current map sizes so an admin can spot abuse
// patterns without paying for external observability tooling. per-instance
// only (lost on cold start), so this is best-effort, not authoritative -
// `distributed` says whether the Upstash-backed counter (which IS
// consistent across instances) is actually active for this deploy.
export function getRateLimitStats(env: Record<string, string | undefined>) {
	return {
		startedAt: new Date(stats.startedAt).toISOString(),
		uptimeSec: Math.round((Date.now() - stats.startedAt) / 1000),
		totalChecks: stats.totalChecks,
		totalAllowed: stats.totalAllowed,
		totalBlockedMinute: stats.totalBlockedMinute,
		totalBlockedDaily: stats.totalBlockedDaily,
		minuteMapSize: rateLimits.size,
		dailyMapSize: dailyLimits.size,
		distributed: isDistributedConfigured(env),
		config: { maxRpm: MAX_RPM, maxRpd: MAX_RPD, maxMapSize: MAX_MAP_SIZE }
	};
}

// exported so tests can drive the limiter without magic numbers
export const RATE_LIMIT_CONFIG = {
	MAX_RPM,
	MAX_RPD
} as const;
