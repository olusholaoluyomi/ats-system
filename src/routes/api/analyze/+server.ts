import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { buildFullScoringPrompt, buildJDAnalysisPrompt } from '$engine/llm/prompts';
import { logger } from '$lib/log';
import { hashPrompt, getCached, setCached } from './cache';
import { checkRateLimit } from './rate-limiter';
import { buildProviders, PROVIDER_ENV_KEYS } from './providers';
import { isProviderExhausted, markProviderExhausted } from './provider-quota';
import { resolveAuthMode } from '$lib/server/auth/config';

// tries each provider in sequence until one succeeds and returns valid JSON.
// promptFor is called once per provider with that provider's own
// contextBudget, so Gemini (huge context window) gets a near-complete
// resume while Groq/Cerebras (tight free-tier TPM ceilings) still get the
// smaller, section-prioritized slice they need to stay under their limits.
// Building lazily per-provider (rather than once up front) also means a
// provider that's skipped for missing credentials never pays the cost of
// having a prompt built for it.
async function callLLM(
	promptFor: (contextBudget: number) => string,
	env: Record<string, string>
): Promise<{ parsed: Record<string, unknown>; provider: string } | null> {
	const providers = buildProviders(env);
	for (const provider of providers) {
		const secret = env[provider.configKey] ?? '';
		if (!secret) continue;

		// Skip providers that have already exhausted their daily free-tier quota.
		// They will be automatically re-enabled at the next UTC midnight.
		if (isProviderExhausted(provider.name)) {
			logger.warn('llm.provider_quota_exhausted', { provider: provider.name });
			continue;
		}

		try {
			const prompt = promptFor(provider.contextBudget);
			const { url, init } = provider.buildRequest(prompt, secret);

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);

			const response = await fetch(url, { ...init, signal: controller.signal });
			clearTimeout(timeout);

			if (!response.ok) {
				const errBody = await response.text().catch(() => '');
				logger.warn('llm.provider_http_error', {
					provider: provider.name,
					status: response.status,
					errorPreview: errBody.slice(0, 300)
				});
				// 429 = daily quota hit. Mark exhausted until UTC midnight so
				// every subsequent request today skips this provider immediately
				// instead of burning its full timeout retrying a depleted key.
				if (response.status === 429) {
					markProviderExhausted(provider.name);
					logger.warn('llm.provider_daily_quota_hit', {
						provider: provider.name,
						message: 'marked exhausted until UTC midnight'
					});
				}
				continue;
			}

			const data = await response.json();
			const text = provider.extractText(data);

			if (!text) {
				logger.warn('llm.provider_empty_text', { provider: provider.name });
				continue;
			}

			// validate JSON before accepting this provider's response
			const parsed = extractJSON(text);
			if (!parsed || typeof parsed !== 'object') {
				logger.warn('llm.provider_unparseable_json', { provider: provider.name });
				continue;
			}

			return { parsed: parsed as Record<string, unknown>, provider: provider.name };
		} catch (err) {
			const isTimeout = err instanceof DOMException && err.name === 'AbortError';
			logger.warn(isTimeout ? 'llm.provider_timeout' : 'llm.provider_failed', {
				provider: provider.name,
				...(isTimeout
					? { timeoutMs: provider.timeoutMs }
					: { error: err instanceof Error ? err.message : String(err) })
			});
			continue;
		}
	}

	return null;
}

// tries to extract JSON from potentially messy LLM output
function extractJSON(raw: string): unknown {
	// try direct parse first
	const trimmed = raw.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		// ignore, try cleaning
	}

	// strip markdown fences
	const cleaned = trimmed.replace(/```json\n?|\n?```/g, '').trim();
	try {
		return JSON.parse(cleaned);
	} catch {
		// ignore, try finding JSON object
	}

	// try to find the first { ... } block
	const start = cleaned.indexOf('{');
	const end = cleaned.lastIndexOf('}');
	if (start !== -1 && end > start) {
		try {
			return JSON.parse(cleaned.slice(start, end + 1));
		} catch {
			// give up
		}
	}

	return null;
}

// must exceed the sum of every provider timeout in the chain (30 + 15 + 12 = 57s) or
// the last leg gets killed by the platform before it can answer, which silently turns
// a 3-provider chain into a shorter one
export const config = {
	maxDuration: 60
};

interface RequestBody {
	mode: 'full-score' | 'analyze-jd';
	resumeText?: string;
	jobDescription?: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	// in ldap self-host mode the scanner sits behind a login, so the analyze API
	// requires a valid session too (defense in depth). public and unchanged in
	// the hosted firebase deploy and anonymous self-host (resolveAuthMode is
	// 'ldap' only when LDAP_URL is set, which neither of those configures).
	if (resolveAuthMode({ ...env, ...publicEnv }) === 'ldap' && !locals.user) {
		return json({ error: 'authentication required' }, { status: 401 });
	}

	// collect provider config from SvelteKit $env. OLLAMA_BASE_URL is the
	// presence signal for the local-Ollama path; OLLAMA_MODEL is read inside
	// buildProviders() and defaults to llama3.2 when unset; OLLAMA_API_KEY is
	// optional and, when set, attaches Authorization: Bearer {key} for forks
	// running Ollama behind a reverse-proxy or hosted Ollama-compatible API.
	// driven off PROVIDER_ENV_KEYS so adding a provider cannot leave its key behind here
	const keys: Record<string, string> = Object.fromEntries(
		PROVIDER_ENV_KEYS.map((k) => [k, env[k] ?? ''])
	);

	// at least one provider must be configured. cloud-hosted instances set
	// GEMINI/GROQ/CEREBRAS; self-hosted forks can opt into Ollama-only by setting
	// OLLAMA_BASE_URL with no cloud keys.
	const hasAnyProvider =
		keys.GEMINI_API_KEY.length > 0 ||
		keys.GROQ_API_KEY.length > 0 ||
		keys.CEREBRAS_API_KEY.length > 0 ||
		keys.OLLAMA_BASE_URL.length > 0;
	if (!hasAnyProvider) {
		return json({ error: 'no LLM providers configured', fallback: true }, { status: 503 });
	}

	// rate limiting per IP
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
	const limit = checkRateLimit(ip);
	if (!limit.allowed) {
		const reasonMsg =
			limit.reason === 'minute' ? 'too many requests this minute' : 'daily limit reached';
		return json(
			{
				error: `rate limit exceeded: ${reasonMsg}. retry after ${limit.retryAfterSec}s.`,
				retryAfter: limit.retryAfterSec
			},
			{
				status: 429,
				headers: { 'Retry-After': String(limit.retryAfterSec) }
			}
		);
	}

	// validate Content-Type
	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.includes('application/json')) {
		throw error(400, 'Content-Type must be application/json');
	}

	let body: RequestBody;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}

	// validate resume text isn't empty/whitespace and enforce length cap
	if (body.resumeText !== undefined) {
		if (body.resumeText.trim().length === 0) {
			throw error(400, 'resumeText cannot be empty');
		}
		if (body.resumeText.length > 50_000) {
			throw error(400, 'resumeText exceeds maximum length of 50,000 characters');
		}
	}

	// enforce length cap on job description
	if (body.jobDescription !== undefined && body.jobDescription.length > 20_000) {
		throw error(400, 'jobDescription exceeds maximum length of 20,000 characters');
	}

	// validate mode is a known value (prevent prompt injection via mode)
	if (body.mode && !['full-score', 'analyze-jd'].includes(body.mode)) {
		throw error(400, 'invalid mode');
	}

	// build a per-provider prompt function based on mode. For full-score this
	// depends on the calling provider's own contextBudget (set in callLLM)
	// so a high-capacity provider like Gemini isn't starved down to the
	// budget a free-tier provider like Groq needs. analyze-jd doesn't
	// involve resume text at all, so its prompt is fixed regardless of
	// which provider ends up serving it.
	let promptFor: (contextBudget: number) => string;

	switch (body.mode) {
		case 'full-score':
			if (!body.resumeText) throw error(400, 'resumeText is required');
			promptFor = (contextBudget) =>
				buildFullScoringPrompt(body.resumeText as string, body.jobDescription, contextBudget);
			break;
		case 'analyze-jd':
			if (!body.jobDescription) throw error(400, 'jobDescription is required');
			promptFor = () => buildJDAnalysisPrompt(body.jobDescription as string);
			break;
		default:
			throw error(400, 'invalid mode');
	}

	const securityHeaders = {
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Cache-Control': 'no-store'
	};

	// ---- billing gate (firebase mode only) ----
	// hosted paid-review model: the first full-score review per account is free,
	// each subsequent one costs a paid credit. this runs BEFORE the cache lookup
	// and the LLM call so the paywall cannot be dodged by resubmitting an
	// identical resume (cache hit) or by falling through to the client's
	// rule-based scorer. ldap/none modes have no wallet concept and skip the
	// block entirely (payments are inert outside firebase mode).
	//
	// a review is consumed for every full-score call that passes the gate and
	// refunded when it produced nothing (cache re-run or total LLM failure), so
	// a paid user is never charged twice for the same resume or for an outage.
	let refund = async (): Promise<void> => {};
	// merge public env: PUBLIC_-prefixed vars (PUBLIC_FIREBASE_PROJECT_ID) are
	// excluded from $env/dynamic/private, so the gate must resolve the mode from
	// both sources exactly like hooks.server.ts / +layout.server.ts do. without
	// this the hosted deploy resolves 'none' and billing never engages.
	const mergedEnv = { ...env, ...publicEnv };
	if (resolveAuthMode(mergedEnv) === 'firebase') {
		const { verifyFirebaseIdToken } = await import('$lib/server/auth/token');
		const identity = await verifyFirebaseIdToken(env, request.headers.get('authorization'));
		if (!identity) {
			return json({ error: 'authentication required' }, { status: 401 });
		}

		if (body.mode === 'full-score') {
			const { getAdminFirestore } = await import('$lib/server/firebase-admin');
			const db = await getAdminFirestore(env);
			if (!db) {
				return json({ error: 'billing is not configured on this deploy' }, { status: 503 });
			}
			const { consumeReview, refundReview } = await import('$lib/server/billing');
			// a billing failure must never surface as a bare 500 mid-scan: log it
			// and fail the request with a clean status so the client can react.
			let verdict;
			try {
				verdict = await consumeReview(db, identity.uid);
			} catch (err) {
				logger.error('billing.consume_failed', {
					uid: identity.uid,
					error: err instanceof Error ? err.message : String(err)
				});
				return json({ error: 'billing is unavailable' }, { status: 503 });
			}
			if (verdict.status === 'blocked') {
				const { parsePriceForCurrency, parseCurrency } = await import('$lib/server/paystack');
				const currency = parseCurrency(env);
				const price = parsePriceForCurrency(env, currency);
				const currencySymbol =
					currency === 'NGN'
						? '₦'
						: currency === 'USD'
							? '$'
							: currency === 'GHS'
								? 'GH₵'
								: currency === 'KES'
									? 'KSh'
									: currency === 'ZAR'
										? 'R'
										: currency;
				return json(
					{
						error: 'payment_required',
						message: `Your free reviews are used up. Each additional review costs ${currencySymbol}${price}.`,
						price,
						currency
					},
					{ status: 402 }
				);
			}
			refund = async () => {
				try {
					await refundReview(db, identity.uid, verdict.used);
				} catch (err) {
					logger.error('billing.refund_failed', {
						uid: identity.uid,
						error: err instanceof Error ? err.message : String(err)
					});
				}
			};
		}
	}

	// content-addressed cache: identical INPUTS return identical results, no
	// LLM call needed. Keyed on the stable request inputs (mode + resume +
	// job description) rather than a single rendered prompt string, since
	// the prompt itself now legitimately varies by which provider ends up
	// serving the request (see callLLM / contextBudget above). A cache hit
	// this way reflects the same underlying resume regardless of which
	// provider's variant produced it.
	const cacheKey = await hashPrompt(
		JSON.stringify({
			mode: body.mode,
			resumeText: body.resumeText ?? null,
			jobDescription: body.jobDescription ?? null
		})
	);
	const cached = getCached(cacheKey);
	if (cached) {
		// the consumed review is refunded on a cache re-run: identical inputs
		// get identical results with no LLM work, so a retried scan or a second
		// look at the same resume must not bill twice. the gate above still ran,
		// so an account that cannot pay stays blocked regardless of the cache.
		await refund();
		return json(
			{ ...cached.parsed, _provider: cached.provider, _fallback: false, _cached: true },
			{ headers: securityHeaders }
		);
	}

	const result = await callLLM(promptFor, keys);

	if (!result) {
		// every leg failing is an outage, not a retryable blip - the per-provider
		// warnings above are individually unremarkable, so this is the only line
		// that distinguishes "one provider hiccuped" from "nobody is scoring"
		logger.error('llm.all_providers_failed', {
			providers: buildProviders(keys).map((p) => p.name),
			mode: body.mode
		});
		// give the consumed review back: an outage must never bill the user.
		await refund();
		return json({ error: 'all LLM providers failed', fallback: true }, { status: 503 });
	}

	setCached(cacheKey, result.parsed, result.provider);

	return json(
		{ ...result.parsed, _provider: result.provider, _fallback: false, _cached: false },
		{ headers: securityHeaders }
	);
};
