// per-account daily cap on analyze-jd calls (the job-description analysis
// mode of /api/analyze). unlike full-score, analyze-jd is not billed through
// consumeReview - it doesn't draw down a review credit - so without a cap of
// its own it was an unlimited, real LLM-API-cost call for any signed-in
// account, bounded only by the per-IP rate limiter (which a caller can dilute
// across many IPs). this keeps it free (matching the product's intent - JD
// analysis is a lightweight preprocessing step, not a scored review) while
// still bounding the worst case.
//
// tries the Upstash-backed distributed counter first (see
// $lib/server/distributed-counter) so the cap holds across every Vercel
// instance; falls back to the in-memory Map below when that isn't
// configured. the in-memory fallback resets on a cold start, which only
// makes the cap more generous, never less.

import { distributedIncrement } from './distributed-counter';

const usage = new Map<string, { count: number; resetAt: number }>();
const MAX_PER_DAY = 50;
const MAX_MAP_SIZE = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanupAt = 0;

export type JDQuotaResult = { allowed: true } | { allowed: false; retryAfterSec: number };

function checkJDAnalysisQuotaLocal(uid: string): JDQuotaResult {
	const now = Date.now();

	if (usage.size > MAX_MAP_SIZE && now - lastCleanupAt > CLEANUP_INTERVAL_MS) {
		for (const [key, val] of usage) {
			if (now > val.resetAt) usage.delete(key);
		}
		lastCleanupAt = now;
	}

	const rec = usage.get(uid);
	if (rec && now < rec.resetAt && rec.count >= MAX_PER_DAY) {
		return { allowed: false, retryAfterSec: Math.ceil((rec.resetAt - now) / 1000) };
	}

	if (rec && now < rec.resetAt) rec.count++;
	else usage.set(uid, { count: 1, resetAt: now + 86_400_000 });

	return { allowed: true };
}

export async function checkJDAnalysisQuota(
	env: Record<string, string | undefined>,
	uid: string
): Promise<JDQuotaResult> {
	const result = await distributedIncrement(env, `rl:jd:${uid}`, 86_400_000);
	if (result !== null) {
		if (result.count > MAX_PER_DAY) {
			return { allowed: false, retryAfterSec: result.retryAfterSec };
		}
		return { allowed: true };
	}

	return checkJDAnalysisQuotaLocal(uid);
}

export const JD_ANALYSIS_QUOTA_CONFIG = { MAX_PER_DAY } as const;
