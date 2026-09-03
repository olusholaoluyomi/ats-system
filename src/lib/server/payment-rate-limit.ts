// per-IP rate limiting for payment-adjacent endpoints (initialize/verify/
// account-delete). tries the Upstash-backed distributed counter first (see
// $lib/server/distributed-counter) so the limit holds across every Vercel
// instance; when that isn't configured (or a call to it fails), falls back
// to the in-memory Maps below - kept as its own module per the project's
// existing convention (see login-rate-limit.ts) so a spike on one hot path
// never contends with another's counters.
//
// keyed by `${action}:${ip}` rather than bare ip: the payment callback page's
// automatic verify polling (up to ~5 calls per checkout - normal behaviour,
// not abuse) draws from its own budget instead of eating into initialize's,
// so a legitimate multi-step checkout can't trip a limit sized for one action.

import { distributedIncrement } from './distributed-counter';

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const dailyLimits = new Map<string, { count: number; resetAt: number }>();
const MAX_RPM = 10;
const MAX_RPD = 50;
const MAX_MAP_SIZE = 10_000;
const CLEANUP_INTERVAL_MS = 30_000;
let lastMinuteCleanupAt = 0;
let lastDailyCleanupAt = 0;

export type PaymentAction = 'initialize' | 'verify' | 'account-delete';

export type PaymentRateLimitResult =
	{ allowed: true } | { allowed: false; reason: 'minute' | 'daily'; retryAfterSec: number };

function checkPaymentRateLimitLocal(key: string): PaymentRateLimitResult {
	const now = Date.now();

	if (rateLimits.size > MAX_MAP_SIZE && now - lastMinuteCleanupAt > CLEANUP_INTERVAL_MS) {
		for (const [k, val] of rateLimits) {
			if (now > val.resetAt) rateLimits.delete(k);
		}
		lastMinuteCleanupAt = now;
	}
	if (dailyLimits.size > MAX_MAP_SIZE && now - lastDailyCleanupAt > CLEANUP_INTERVAL_MS) {
		for (const [k, val] of dailyLimits) {
			if (now > val.resetAt) dailyLimits.delete(k);
		}
		lastDailyCleanupAt = now;
	}

	// check both windows BEFORE incrementing, so a daily-limit failure
	// doesn't also consume a minute slot
	const minute = rateLimits.get(key);
	if (minute && now < minute.resetAt && minute.count >= MAX_RPM) {
		return {
			allowed: false,
			reason: 'minute',
			retryAfterSec: Math.ceil((minute.resetAt - now) / 1000)
		};
	}

	const day = dailyLimits.get(key);
	if (day && now < day.resetAt && day.count >= MAX_RPD) {
		return {
			allowed: false,
			reason: 'daily',
			retryAfterSec: Math.ceil((day.resetAt - now) / 1000)
		};
	}

	if (minute && now < minute.resetAt) minute.count++;
	else rateLimits.set(key, { count: 1, resetAt: now + 60_000 });

	if (day && now < day.resetAt) day.count++;
	else dailyLimits.set(key, { count: 1, resetAt: now + 86_400_000 });

	return { allowed: true };
}

export async function checkPaymentRateLimit(
	env: Record<string, string | undefined>,
	action: PaymentAction,
	ip: string
): Promise<PaymentRateLimitResult> {
	const key = `${action}:${ip}`;

	const [minute, day] = await Promise.all([
		distributedIncrement(env, `rl:pay:m:${key}`, 60_000),
		distributedIncrement(env, `rl:pay:d:${key}`, 86_400_000)
	]);

	if (minute !== null && day !== null) {
		if (minute.count > MAX_RPM) {
			return { allowed: false, reason: 'minute', retryAfterSec: minute.retryAfterSec };
		}
		if (day.count > MAX_RPD) {
			return { allowed: false, reason: 'daily', retryAfterSec: day.retryAfterSec };
		}
		return { allowed: true };
	}

	return checkPaymentRateLimitLocal(key);
}

// exported so tests can drive the limiter without magic numbers
export const PAYMENT_RATE_LIMIT_CONFIG = { MAX_RPM, MAX_RPD } as const;
