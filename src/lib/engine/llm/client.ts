import type { ScoreResult, Suggestion, StructuredSuggestion } from '$engine/scorer/types';
import { incrementResumesAnalyzed } from '$lib/insights';
import { logger } from '$lib/log';
import { authStore } from '$stores/auth.svelte';

const CLIENT_TIMEOUT_MS = 65_000;

// discriminated result so callers can distinguish "fall back to rule-based"
// from "user cancelled, do nothing" - the two need different downstream handling
// rate_limited is treated like error for fallback purposes, but carries a retry
// hint so the UI can tell users when the AI path will be available again
// payment_required is NOT a fallback signal: the scanner must show the paywall
// and must NOT fall through to the free rule-based scorer, or the pay-per-review
// model is bypassed client-side.
export interface LLMFailureReason {
	provider?: string;
	error?: string;
	httpStatus?: number;
	retryAfterSec?: number;
}

export type ScoreLLMResult =
	| { status: 'ok'; results: ScoreResult[]; provider: string; fallback: boolean }
	| {
			status: 'error';
			failureReasons?: LLMFailureReason[];
			triedProviders?: string[];
	  }
	| { status: 'rate_limited'; retryAfterSec: number }
	// price/currency are NOT carried here - the scanner fetches the real
	// server-configured price up front via /api/pricing and keeps it live,
	// rather than trusting a field on this one response (which drifted: the
	// server sends `price`, this used to read a nonexistent `priceNgn` and
	// silently fall back to a hardcoded default on every call).
	| { status: 'payment_required' }
	// server-side auth failed (401): firebase visitor not signed in / token
	// rejected, or expired ldap session. NOT a fallback signal - scanning must
	// require sign-up, so the caller routes to the login page instead of
	// degrading to the free rule-based scorer.
	| { status: 'auth_required' }
	| { status: 'cancelled' };

// the analyze billing gate verifies a firebase ID token, so firebase-mode
// clients attach it as a bearer header. ldap/none modes send nothing (the
// server only enforces billing in firebase mode).
async function authHeaders(forceRefresh = false): Promise<Record<string, string>> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (authStore.mode === 'firebase') {
		const token = await authStore.getIdToken(forceRefresh);
		if (token) headers['Authorization'] = `Bearer ${token}`;
	}
	return headers;
}

// isolated so scoreLLM can call it twice (initial + forced-refresh retry)
// without duplicating the fetch options.
async function postAnalyze(
	body: string,
	headers: Record<string, string>,
	signal: AbortSignal
): Promise<Response> {
	return fetch('/api/analyze', { method: 'POST', headers, body, signal });
}

// performs full LLM-powered ATS scoring via the server endpoint
// caller can pass an AbortSignal to cancel an in-flight request (e.g. on rescan/reset)
export async function scoreLLM(
	resumeText: string,
	jobDescription?: string,
	options?: { signal?: AbortSignal }
): Promise<ScoreLLMResult> {
	const external = options?.signal;
	if (external?.aborted) return { status: 'cancelled' };

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
	const onExternalAbort = () => controller.abort();
	external?.addEventListener('abort', onExternalAbort, { once: true });

	try {
		const requestBody = JSON.stringify({
			mode: 'full-score',
			resumeText,
			jobDescription
		});

		let response = await postAnalyze(requestBody, await authHeaders(), controller.signal);

		// the cached ID token can be stale (expired, clock skew, tab left open
		// past the hourly refresh) even though the Firebase client session is
		// still perfectly valid. before treating a 401 as "not signed in" and
		// bouncing to /login, force a fresh token and retry once - mirrors the
		// same retry payment.ts already does for /api/payment/initialize.
		// only worth trying in firebase mode: an ldap 401 means the session
		// cookie itself is gone, which a token refresh can't fix.
		if (response.status === 401 && authStore.mode === 'firebase') {
			logger.info('llm.token_expired_refreshing');
			response = await postAnalyze(requestBody, await authHeaders(true), controller.signal);
		}

		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			logger.warn('llm.api_error', {
				status: response.status,
				error: data.error ?? 'unknown error'
			});
			if (response.status === 401) {
				// still rejected after a forced refresh (or the ldap session is
				// genuinely gone): the visitor really isn't signed in. scanning
				// requires an account, so route to the login page instead of
				// degrading to the free rule-based scorer.
				return { status: 'auth_required' };
			}
			if (response.status === 429) {
				const headerVal = response.headers.get('Retry-After');
				const retryAfterSec =
					typeof data.retryAfter === 'number' && data.retryAfter > 0
						? data.retryAfter
						: headerVal && Number.isFinite(Number(headerVal))
							? Math.max(1, Number(headerVal))
							: 60;
				return { status: 'rate_limited', retryAfterSec };
			}
			if (response.status === 402) {
				// the free reviews are used up and the account has no credits left.
				// distinct from a generic error: the scanner shows the paywall and
				// must NOT degrade to the rule-based scorer.
				return { status: 'payment_required' };
			}
			return { status: 'error' };
		}

		const data = await response.json();

		if (data._fallback || !data.results || !Array.isArray(data.results)) {
			logger.warn('llm.fallback_to_rule_based', {
				reason: 'response missing results or fallback flag'
			});
			return { status: 'error' };
		}

		// validate and normalize the LLM response to match ScoreResult[]
		const results: ScoreResult[] = data.results.map((r: Record<string, unknown>) =>
			normalizeScoreResult(r)
		);

		// this resume made it through a real analysis; bump the landing page's
		// Resumes Analyzed counter. fire-and-forget: a failed write must not
		// fail or delay the scan that just succeeded.
		void incrementResumesAnalyzed();

		return {
			status: 'ok',
			results,
			provider: (data._provider as string) ?? 'unknown',
			fallback: false
		};
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			if (external?.aborted) return { status: 'cancelled' };
			logger.warn('llm.client_timeout', { timeoutMs: CLIENT_TIMEOUT_MS });
		}
		// if the server returned a structured failure (with per-provider reasons),
		// forward those details instead of a generic 'error' status
		if (err instanceof Object && 'failureReasons' in err) {
			return {
				status: 'error',
				failureReasons: (err as { failureReasons: LLMFailureReason[]; triedProviders?: string[] })
					.failureReasons,
				triedProviders: (err as { failureReasons: LLMFailureReason[]; triedProviders?: string[] })
					.triedProviders
			};
		}
		return { status: 'error' };
	} finally {
		clearTimeout(timeout);
		external?.removeEventListener('abort', onExternalAbort);
	}
}

// normalizes LLM output to our exact ScoreResult type with safe defaults
function normalizeScoreResult(raw: Record<string, unknown>): ScoreResult {
	const breakdown = (raw.breakdown ?? {}) as Record<string, unknown>;
	const formatting = (breakdown.formatting ?? {}) as Record<string, unknown>;
	const keywordMatch = (breakdown.keywordMatch ?? {}) as Record<string, unknown>;
	const sections = (breakdown.sections ?? {}) as Record<string, unknown>;
	const experience = (breakdown.experience ?? {}) as Record<string, unknown>;
	const education = (breakdown.education ?? {}) as Record<string, unknown>;

	return {
		system: String(raw.system ?? 'Unknown'),
		vendor: String(raw.vendor ?? 'Unknown'),
		overallScore: clamp(Number(raw.overallScore) || 0, 0, 100),
		passesFilter: Boolean(raw.passesFilter),
		breakdown: {
			formatting: {
				score: clamp(Number(formatting.score) || 0, 0, 100),
				issues: toStringArray(formatting.issues),
				details: toStringArray(formatting.details)
			},
			keywordMatch: {
				score: clamp(Number(keywordMatch.score) || 0, 0, 100),
				matched: toStringArray(keywordMatch.matched),
				missing: toStringArray(keywordMatch.missing),
				synonymMatched: toStringArray(keywordMatch.synonymMatched)
			},
			sections: {
				score: clamp(Number(sections.score) || 0, 0, 100),
				present: toStringArray(sections.present),
				missing: toStringArray(sections.missing)
			},
			experience: {
				score: clamp(Number(experience.score) || 0, 0, 100),
				quantifiedBullets: Number(experience.quantifiedBullets) || 0,
				totalBullets: Number(experience.totalBullets) || 0,
				actionVerbCount: Number(experience.actionVerbCount) || 0,
				highlights: toStringArray(experience.highlights)
			},
			education: {
				score: clamp(Number(education.score) || 0, 0, 100),
				notes: toStringArray(education.notes)
			}
		},
		suggestions: toSuggestionArray(raw.suggestions)
	};
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Math.round(n)));
}

function toStringArray(val: unknown): string[] {
	if (!Array.isArray(val)) return [];
	return val.filter((v) => typeof v === 'string');
}

function toSuggestionArray(val: unknown): Suggestion[] {
	if (!Array.isArray(val)) return [];
	return val
		.map((item) => {
			if (typeof item === 'string') return item;
			if (item && typeof item === 'object' && 'summary' in item) {
				return normalizeStructuredSuggestion(item as Record<string, unknown>);
			}
			return null;
		})
		.filter((v): v is Suggestion => v !== null);
}

function normalizeStructuredSuggestion(raw: Record<string, unknown>): StructuredSuggestion {
	const validImpacts = ['critical', 'high', 'medium', 'low'] as const;
	const impact = validImpacts.includes(raw.impact as (typeof validImpacts)[number])
		? (raw.impact as StructuredSuggestion['impact'])
		: 'medium';

	return {
		summary: String(raw.summary ?? ''),
		details: toStringArray(raw.details),
		impact,
		platforms: toStringArray(raw.platforms)
	};
}
