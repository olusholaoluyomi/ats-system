// Per-provider daily quota tracker.
//
// When a provider returns HTTP 429 the caller marks it exhausted here.
// Subsequent requests skip that provider entirely until UTC midnight, at which
// point all free-tier quotas reset and Gemini becomes primary again.
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

// Returns the unix-ms timestamp of the next UTC midnight from now.
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
 * Marks a provider as exhausted until the next UTC midnight.
 * Call this when the provider returns HTTP 429 (daily quota hit).
 * Idempotent: calling it multiple times does not push the reset further.
 */
export function markProviderExhausted(name: string): void {
	// Only set if not already exhausted, so the first 429 wins and subsequent
	// calls from the same instance don't accidentally extend the window.
	if (!isProviderExhausted(name)) {
		quotaState.set(name, { exhaustedUntil: nextUtcMidnightMs() });
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
