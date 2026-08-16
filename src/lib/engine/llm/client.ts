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
export type ScoreLLMResult =
	| { status: 'ok'; results: ScoreResult[]; provider: string; fallback: boolean }
	| { status: 'error' }
	| { status: 'rate_limited'; retryAfterSec: number }
	| { status: 'payment_required'; priceNgn: number }
	// server-side auth failed (401): firebase visitor not signed in / token
	// rejected, or expired ldap session. NOT a fallback signal - scanning must
	// require sign-up, so the caller routes to the login page instead of
	// degrading to the free rule-based scorer.
	| { status: 'auth_required' }
	| { status: 'cancelled' };

// the analyze billing gate verifies a firebase ID token, so firebase-mode
// clients attach it as a bearer header. ldap/none modes send nothing (the
// server only enforces billing in firebase mode).
async function authHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (authStore.mode === 'firebase') {
		const token = await authStore.getIdToken();
		if (token) headers['Authorization'] = `Bearer ${token}`;
	}
	return headers;
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
		const response = await fetch('/api/analyze', {
			method: 'POST',
			headers: await authHeaders(),
			body: JSON.stringify({
				mode: 'full-score',
				resumeText,
				jobDescription
			}),
			signal: controller.signal
		});

		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			logger.warn('llm.api_error', {
				status: response.status,
				error: data.error ?? 'unknown error'
			});
			if (response.status === 401) {
				// not signed in (or the identity token was rejected). scanning
				// requires an account, so this must NOT degrade to rule-based
				// scoring - the scanner routes the visitor to the login page.
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
				return {
					status: 'payment_required',
					priceNgn: typeof data.priceNgn === 'number' ? data.priceNgn : 10000
				};
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
				failureReasons: (err as { failureReasons: unknown }).failureReasons,
				triedProviders: (err as { triedProviders: unknown }).triedProviders
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
