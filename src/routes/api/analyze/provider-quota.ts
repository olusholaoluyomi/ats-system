// Per-provider quota/rate-limit tracker.
//
// When a provider returns HTTP 429, the caller marks it exhausted here for a
// bounded window so subsequent requests skip it immediately instead of
// burning a full timeout retrying a provider that just rejected a call.
//
// IMPORTANT: HTTP 429 means "too many requests" - it does NOT by itself mean
// "the whole day's quota is gone". It's the same status code for a genuine
// daily/monthly quota exhaustion AND a transient per-minute rate limit (the
// far more common case: a free-tier model with a low RPM ceiling hit by one
// user submitting a couple of scans close together). An earlier version of
// this module treated every 429 as the former and blocked the provider until
// UTC midnight regardless - one user's transient rate limit on Gemini,
// followed shortly by the same thing on the Groq fallback, was enough to
// make EVERY user see "All LLM providers failed" for the rest of the day,
// even though the underlying per-minute limits had already reset within
// seconds (2026-09-05 incident). The fix: honor the provider's own
// Retry-After when it sends one (that's the provider telling us exactly how
// long to back off), and fall back to a short, conservative default instead
// of a full day when it doesn't - a provider that's GENUINELY out for the
// day will just get re-marked exhausted on the next attempt a few minutes
// later, which is a far smaller cost than blocking everyone for hours on a
// guess.
//
// Storage: plain in-memory Map. Same trade-off as rate-limiter.ts and cache.ts:
// state is lost on a Vercel cold start, but within a warm instance (which
// handles the bulk of traffic in a healthy deploy) it persists across requests
// and achieves the desired skipping behaviour without any paid KV store.
// Upgrade path: swap the Map for an Upstash Redis / Vercel KV adapter behind
// the same exported API without touching the callers.

interface QuotaEntry {
	exhaustedUntil: number; // unix ms; 0 = not exhausted
}

const quotaState = new Map<string, QuotaEntry>();

// used when a 429 carries no Retry-After / retryDelay hint at all - long
// enough to meaningfully back off, short enough that a real daily-quota
// outage just gets re-marked a few times over the day instead of silently
// blocking every user until midnight on one ambiguous response.
const DEFAULT_BACKOFF_MS = 5 * 60 * 1000;

// upper bound on any single exhaustion window, including an explicit
// Retry-After - a provider sending a nonsensical multi-day value should
// never lock out every user for longer than the natural daily quota reset.
function nextUtcMidnightMs(): number {
	const now = new Date();
	const midnight = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
	);
	return midnight.getTime();
}

/**
 * Returns true if the provider has been marked exhausted and its reset time
 * has not yet passed. Returns false for unknown providers (never exhausted).
 */
export function isProviderExhausted(name: string): boolean {
	const entry = quotaState.get(name);
	if (!entry) return false;
	if (Date.now() >= entry.exhaustedUntil) {
		// Reset time has passed — clean up and allow the provider again.
		quotaState.delete(name);
		return false;
	}
	return true;
}

/**
 * Marks a provider as exhausted after an HTTP 429. `retryAfterMs`, when the
 * provider's response included one (a Retry-After header or a provider-
 * specific retry hint), sets exactly how long to back off; omit it only when
 * the response gave no hint at all, which backs off for DEFAULT_BACKOFF_MS
 * rather than assuming a full-day outage. Either way the window is capped at
 * the next UTC midnight. Idempotent: calling it again while already
 * exhausted does not push the reset further out.
 */
export function markProviderExhausted(name: string, retryAfterMs?: number): void {
	// Only set if not already exhausted, so the first 429 wins and subsequent
	// calls from the same instance don't accidentally extend the window.
	if (!isProviderExhausted(name)) {
		const requested = Date.now() + (retryAfterMs ?? DEFAULT_BACKOFF_MS);
		quotaState.set(name, { exhaustedUntil: Math.min(requested, nextUtcMidnightMs()) });
	}
}

/**
 * Observability surface — returns a snapshot of the current quota state for
 * every tracked provider. Exposed via the admin endpoint so operators can
 * see which providers are currently exhausted without needing to grep logs.
 */
export function getQuotaState(): Record<string, { exhaustedUntil: string; resetsIn: string }> {
	const now = Date.now();
	const result: Record<string, { exhaustedUntil: string; resetsIn: string }> = {};
	for (const [name, entry] of quotaState) {
		const remainingMs = Math.max(0, entry.exhaustedUntil - now);
		const remainingMin = Math.round(remainingMs / 60_000);
		result[name] = {
			exhaustedUntil: new Date(entry.exhaustedUntil).toISOString(),
			resetsIn: remainingMs === 0 ? 'now' : `${remainingMin}m`
		};
	}
	return result;
}
