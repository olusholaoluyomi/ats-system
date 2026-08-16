// LLM provider abstraction for /api/analyze.
//
// cloud chain is Gemini 3.5 Flash Lite (Google) -> Llama 3.3 70B (Groq): one model
// per vendor, because a second model on the same key shares that key's quota and adds
// no real redundancy. crossing vendors is what keeps one provider's limits from
// cascading. both models were measured against the real full-scoring prompt rather
// than picked from published limits - see buildProviders.
//
// self-hosters can prepend Ollama by setting OLLAMA_BASE_URL (and optionally
// OLLAMA_MODEL, plus OLLAMA_API_KEY for proxied / auth-gated daemons); the
// request handler treats Ollama as a configured provider so a fork running
// purely on local models doesn't need any cloud API key.
//
// timeoutMs lives on the provider itself (not a parallel array) so a dynamic
// chain composed from env can carry per-provider deadlines without
// index-juggling. extracted into its own module so the chain composition can
// be unit-tested without mounting the whole route handler.

export interface LLMProviderFailure {
	provider: string;
	error: string;
	httpStatus?: number;
	retryAfterSec?: number;
}

// discriminated result so callers can distinguish "all providers failed" from
// "no providers configured" (which is a 503 with a different message).
export interface LLMProvider {
	name: string;
	// env var that must be non-empty for this provider to be considered "configured"
	configKey: string;
	timeoutMs: number;
	// Character budget for resume content in the prompt. This used to be a
	// single hardcoded number (6000) shared by every provider, sized for
	// Groq's free-tier ceiling - which meant Gemini (1M token context
	// window) and a self-hosted Ollama model were both being starved down
	// to the same tiny slice a much weaker provider needed. Each provider
	// now declares what it can actually handle, and the route builds a
	// per-provider prompt instead of one shared one. See buildProviders for
	// the reasoning behind each value.
	contextBudget: number;
	buildRequest: (prompt: string, secret: string) => { url: string; init: RequestInit };
	extractText: (response: unknown) => string;
}

// shared extractor for all Google Generative Language API models. defensive
// against null / non-object payloads because optional chaining only saves us
// AFTER a non-null object base; a malformed response that decodes to null
// still throws on `.candidates` without this guard.
const googleExtractText = (data: unknown) => {
	if (!data || typeof data !== 'object') return '';
	const d = data as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
	return d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
};

// measured against the real full-scoring prompt (both slices at their caps):
// ~5,950 tokens in, 2,950-3,419 out over repeated runs at 311-338 tok/s. output size
// tracks the fixed 6-platform schema, not the user's resume length - a minimal resume
// produced within 5% of a maxed-out one - so both directions are already bounded.
//
// INVARIANT: maxOutputTokens / slowest-observed-throughput must stay under timeoutMs,
// or a response that legitimately runs to its full budget gets aborted mid-flight and
// burns the fallback too. 6144 / 311 tok/s = 19.8s against a 30s timeout.
//
// 6144 is ~1.8x the largest output ever observed, so truncation risk stays remote.
const GOOGLE_MAX_OUTPUT_TOKENS = 6144;

export function buildGoogleProvider(
	name: string,
	model: string,
	opts?: {
		jsonMode?: boolean;
		timeoutMs?: number;
		maxOutputTokens?: number;
		contextBudget?: number;
	}
): LLMProvider {
	return {
		name,
		configKey: 'GEMINI_API_KEY',
		// flash-lite answers the full prompt in 9-11s measured. 30s covers the worst
		// case where the model runs to the full token budget (19.8s) with margin,
		// while keeping the whole chain inside the route's maxDuration
		timeoutMs: opts?.timeoutMs ?? 30_000,
		// Gemini 3.5 Flash-Lite has a 1,048,576-token (~4M character) context
		// window - the 6000-char cap this used to share with Groq was leaving
		// ~99.9% of its real capacity unused. Capped at 45,000 chars, comfortably
		// under the route's own 50,000-char resumeText upload ceiling (see
		// +server.ts validation), so a resume this provider receives is never
		// truncated for any input the app would accept in the first place.
		contextBudget: opts?.contextBudget ?? 45_000,
		buildRequest: (prompt, apiKey) => ({
			url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
			init: {
				method: 'POST',
				// key goes in the header, not ?key=, so it stays out of urls and request lines
				headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: 0.3,
						topP: 0.85,
						maxOutputTokens: opts?.maxOutputTokens ?? GOOGLE_MAX_OUTPUT_TOKENS,
						// default on: the scoring contract is JSON, and without this the
						// model returns prose that extractJSON has to salvage
						...(opts?.jsonMode !== false && { responseMimeType: 'application/json' })
					}
				})
			}
		}),
		extractText: googleExtractText
	};
}

// Groq reserves (input + max_tokens) against its per-minute ceiling BEFORE running
// the model, so an oversized max_tokens alone can exceed the whole TPM budget and
// every request 413s regardless of input size. free-tier llama TPM is 12,000 and the
// real prompt measures ~5,950 in / ~2,020 out at ~290 tok/s.
//
// 3072 serves two masters: it keeps 5,950 + 3,072 = 9,022 under the 12k TPM ceiling
// (leaving room for a second request in the same minute), and 3072 / 290 tok/s = 10.6s
// stays under the 15s timeout so a full-budget response is never cut off.
const GROQ_MAX_TOKENS = 3072;

export function buildGroqProvider(
	name: string,
	model: string,
	opts?: { maxTokens?: number; contextBudget?: number }
): LLMProvider {
	return {
		name,
		configKey: 'GROQ_API_KEY',
		// Groq is <1s typical but gets headroom for cold path
		timeoutMs: 15_000,
		// Tuned against the free-tier 12,000 TPM ceiling (input + output
		// combined, reserved before the model even runs - see the buildProviders
		// comment for the exact math). This is the real constraint, not a
		// content-quality choice, so do not raise it without re-measuring
		// against Groq's TPM limit.
		contextBudget: opts?.contextBudget ?? 6_000,
		buildRequest: (prompt, apiKey) => ({
			url: 'https://api.groq.com/openai/v1/chat/completions',
			init: {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model,
					messages: [{ role: 'user', content: prompt }],
					temperature: 0.3,
					top_p: 0.85,
					max_tokens: opts?.maxTokens ?? GROQ_MAX_TOKENS,
					response_format: { type: 'json_object' }
				})
			}
		}),
		extractText: (data: unknown) => {
			if (!data || typeof data !== 'object') return '';
			const d = data as { choices?: { message?: { content?: string } }[] };
			return d.choices?.[0]?.message?.content ?? '';
		}
	};
}

// Cerebras is the replacement cross-vendor leg for Groq, which loses its only model
// that fits this prompt on 2026-08-16. same OpenAI-shaped contract, and it serves the
// same llama-3.3-70b this prompt was already tuned against, so output size carries over.
// inert until CEREBRAS_API_KEY is set, exactly like the Ollama leg.
const CEREBRAS_MAX_TOKENS = 3072;

export function buildCerebrasProvider(
	name: string,
	model: string,
	opts?: { maxTokens?: number; contextBudget?: number }
): LLMProvider {
	return {
		name,
		configKey: 'CEREBRAS_API_KEY',
		// 30 + 15 + 12 = 57s, inside the route's maxDuration of 60. cerebras is the
		// fastest leg in the chain, so 12s is already generous for a 3072 token budget
		timeoutMs: 12_000,
		// same model/budget math as Groq above - this is the replacement leg for
		// the same free-tier-constrained slot, not an independently-tuned value
		contextBudget: opts?.contextBudget ?? 6_000,
		buildRequest: (prompt, apiKey) => ({
			url: 'https://api.cerebras.ai/v1/chat/completions',
			init: {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model,
					messages: [{ role: 'user', content: prompt }],
					temperature: 0.3,
					top_p: 0.85,
					max_tokens: opts?.maxTokens ?? CEREBRAS_MAX_TOKENS,
					response_format: { type: 'json_object' }
				})
			}
		}),
		extractText: (data: unknown) => {
			if (!data || typeof data !== 'object') return '';
			const d = data as { choices?: { message?: { content?: string } }[] };
			return d.choices?.[0]?.message?.content ?? '';
		}
	};
}

// Ollama provider for self-hosters. local daemon by default needs no key;
// reverse-proxied or hosted Ollama-compatible endpoints (OpenWebUI, LiteLLM,
// OpenRouter, a Cloudflare-tunnel + service token, etc.) take an
// optional bearer token via opts.apiKey, which is attached as
// `Authorization: Bearer {key}` on every request. format: 'json' asks the
// model to return strict JSON without ad-hoc prompt engineering. the secret
// param carries the base URL so all providers share the same factory
// signature; trailing slashes are stripped to make OLLAMA_BASE_URL= forgiving.
export function buildOllamaProvider(
	name: string,
	model: string,
	opts?: { apiKey?: string; numCtx?: number; contextBudget?: number }
): LLMProvider {
	// trim and treat empty / whitespace-only as not set so a stray
	// OLLAMA_API_KEY= line in .env does not produce a bogus
	// `Authorization: Bearer ` header that the proxy would reject as malformed.
	const apiKey = opts?.apiKey?.trim() ?? '';
	// 16384 was a hardcoded default matching the cloud providers' max_tokens,
	// which quietly caps every self-hosted model at ~65k characters even if
	// the operator is running a genuinely long-context open model (Llama
	// 3.1/3.3 128k, Qwen2.5 128k, Mistral Nemo 128k; Mistral Nemo 128k).
	// Configurable via OLLAMA_NUM_CTX so self-hosters can raise it to match
	// whatever they're actually running - see buildProviders.
	const numCtx = opts?.numCtx ?? 16384;
	// resume character budget scales with numCtx (rough 4 chars/token, minus
	// headroom for the rest of the prompt + JD + output) rather than being
	// pinned to the same fixed number as the cloud fallback legs
	const contextBudget = opts?.contextBudget ?? Math.max(6_000, Math.floor(numCtx * 2.2));
	return {
		name,
		configKey: 'OLLAMA_BASE_URL',
		// local models on commodity hardware can be slow on cold start. allow up
		// to 4 minutes for the first request; subsequent calls hit the model
		// cache and are much faster.
		timeoutMs: 240_000,
		contextBudget,
		buildRequest: (prompt, baseUrl) => ({
			url: `${baseUrl.replace(/\/+$/, '')}/api/chat`,
			init: {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(apiKey && { Authorization: `Bearer ${apiKey}` })
				},
				body: JSON.stringify({
					model,
					messages: [{ role: 'user', content: prompt }],
					stream: false,
					format: 'json',
					options: {
						temperature: 0.3,
						top_p: 0.85,
						num_ctx: numCtx
					}
				})
			}
		}),
		extractText: (data: unknown) => {
			if (!data || typeof data !== 'object') return '';
			const d = data as { message?: { content?: string } };
			return d.message?.content ?? '';
		}
	};
}

// composes the provider chain from whatever's configured in env. ordering is
// intentional: when Ollama is configured we put it first so a self-hoster who
// also has cloud keys still defaults to local. callers without any of the
// three configured will see an empty array and the route returns 503.
// every env var buildProviders reads. the route copies exactly these out of $env, so a
// name missing here silently disables a whole leg no matter how the var is configured
export const PROVIDER_ENV_KEYS = [
	'GEMINI_API_KEY',
	'GROQ_API_KEY',
	'CEREBRAS_API_KEY',
	'OLLAMA_BASE_URL',
	'OLLAMA_MODEL',
	'OLLAMA_API_KEY',
	'OLLAMA_NUM_CTX'
] as const;

export function buildProviders(env: Record<string, string>): LLMProvider[] {
	const providers: LLMProvider[] = [];

	// 1. Gemini (always first — primary cloud LLM)
	if (env.GEMINI_API_KEY) {
		providers.push(buildGoogleProvider('gemini-3.5-flash-lite', 'gemini-3.5-flash-lite'));
	}

	// 2. Groq (cross-vendor fallback for Google outages)
	if (env.GROQ_API_KEY) {
		providers.push(buildGroqProvider('groq-llama-3.3-70b', 'llama-3.3-70b-versatile'));
	}

	// 3. Cerebras (replacement for Groq when it shuts down 2026-08-16)
	if (env.CEREBRAS_API_KEY) {
		providers.push(buildCerebrasProvider('cerebras-llama-3.3-70b', 'llama-3.3-70b'));
	}

	// 4. Ollama (last — self-hosted local daemon, only if explicitly configured)
	// Ollama is intentionally placed last so the cloud chain always runs first.
	// When OLLAMA_BASE_URL is set, a self-hoster who also has cloud keys still
	// defaults to the cloud chain; Ollama only serves as a final fallback for
	// forks running purely on local models with no cloud keys.
	if (env.OLLAMA_BASE_URL) {
		const model = env.OLLAMA_MODEL || 'llama3.2';
		// OLLAMA_API_KEY is optional. when set we attach Authorization: Bearer
		// {key} so the request gets through a reverse-proxy or hosted endpoint
		// that gates the daemon (OpenWebUI, LiteLLM, Caddy bearer auth, etc.).
		// vanilla localhost ollama leaves this unset and behaves as before.
		const apiKey = env.OLLAMA_API_KEY || undefined;
		// optional: self-hosters running a long-context open model (Llama
		// 3.1/3.3 128k, Qwen2.5 128k, Mistral Nemo 128k) can set this to use
		// their model's real context window instead of the 16384 default -
		// e.g. OLLAMA_NUM_CTX=131072 for a genuine 128k-context model. Ollama
		// will silently fall back to whatever the model actually supports if
		// this is set higher than the model allows.
		const numCtx = env.OLLAMA_NUM_CTX ? parseInt(env.OLLAMA_NUM_CTX, 10) : undefined;
		providers.push(
			buildOllamaProvider(`ollama-${model}`, model, {
				apiKey,
				...(numCtx && !Number.isNaN(numCtx) && { numCtx })
			})
		);
	}

	return providers;
}

/**
 * Parses a Retry-After header value from a provider error response body.
 * Accepts numeric seconds, HTTP-date format, or the string 'infinite'.
 */
function parseRetryAfter(body: string): number | undefined {
	const trimmed = body.trim();
	// try direct number
	const num = Number(trimmed);
	if (!Number.isNaN(num) && num > 0) return num;
	// try HTTP-date format (e.g., "Wed, 21 Oct 2015 07:28:00 GMT")
	// not fully ISO-8601 compliant but good enough for Retry-After
	const match = trimmed.match(/^([0-9]{2},[0-9]{2}[0-9]{2}[0-9]{2}\s+[A-Z]{3}\s+[0-9]{4})$/);
	if (match) return undefined; // can't easily compute seconds from this
	// try "infinite"
	if (trimmed.toLowerCase() === 'infinite') return undefined;
	return undefined;
}

// calls each provider in sequence until one succeeds and returns valid JSON.
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
): Promise<
	| { parsed: Record<string, unknown>; provider: string }
	| { failures: LLMProviderFailure[]; providers: LLMProvider[] }
	| null
> {
	const providers = buildProviders(env);

	// if no provider is configured at all, return null (caller will show 503)
	if (providers.length === 0) {
		return null;
	}

	const failures: LLMProviderFailure[] = [];

	for (const provider of providers) {
		const secret = env[provider.configKey] ?? '';
		if (!secret) continue;

		// Skip providers that have already exhausted their daily free-tier quota.
		// They will be automatically re-enabled at the next UTC midnight.
		if (isProviderExhausted(provider.name)) {
			logger.warn('llm.provider_quota_exhausted', { provider: provider.name });
			failures.push({
				provider: provider.name,
				error: 'daily quota exhausted until UTC midnight'
			});
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
				const httpStatus = response.status;
				logger.warn('llm.provider_http_error', {
					provider: provider.name,
					status: httpStatus,
					errorPreview: errBody.slice(0, 300)
				});
				// 429 = daily quota hit. Mark exhausted until UTC midnight so
				// every subsequent request today skips this provider immediately
				// instead of burning its full timeout retrying a depleted key.
				if (httpStatus === 429) {
					markProviderExhausted(provider.name);
					logger.warn('llm.provider_daily_quota_hit', {
						provider: provider.name,
						message: 'marked exhausted until UTC midnight'
					});
					failures.push({
						provider: provider.name,
						error: 'daily quota exceeded',
						httpStatus: 429,
						retryAfterSec: parseRetryAfter(errBody)
					});
				} else {
					failures.push({
						provider: provider.name,
						error: errBody.slice(0, 200),
						httpStatus
					});
				}
				continue;
			}

			const data = await response.json();
			const text = provider.extractText(data);

			if (!text) {
				logger.warn('llm.provider_empty_text', { provider: provider.name });
				failures.push({
					provider: provider.name,
					error: 'empty response text'
				});
				continue;
			}

			// validate JSON before accepting this provider's response
			const parsed = extractJSON(text);
			if (!parsed || typeof parsed !== 'object') {
				logger.warn('llm.provider_unparseable_json', { provider: provider.name });
				failures.push({
					provider: provider.name,
					error: 'unparseable JSON response'
				});
				continue;
			}

			return { parsed: parsed as Record<string, unknown>, provider: provider.name };
		} catch (err) {
			const isTimeout = err instanceof DOMException && err.name === 'AbortError';
			const errorMsg = isTimeout
				? `request timeout after ${provider.timeoutMs}ms`
				: err instanceof Error
					? err.message
					: String(err);
			logger.warn(isTimeout ? 'llm.provider_timeout' : 'llm.provider_failed', {
				provider: provider.name,
				...(isTimeout ? { timeoutMs: provider.timeoutMs } : { error: errorMsg })
			});
			failures.push({
				provider: provider.name,
				error: errorMsg
			});
			continue;
		}
	}

	// all providers exhausted — return failures + provider list so caller can
	// distinguish this from "no providers configured" (null return)
	return { failures, providers };
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
	// hosted paid-review model: the first 4 full-score reviews per account are free,
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

	// if we got here with failures (all providers exhausted), return the error
	// with detailed failure reasons instead of just "all LLM providers failed"
	if ('failures' in result && result.failures.length > 0) {
		return json(
			{
				error: 'all LLM providers failed',
				fallback: true,
				// include per-provider failure reasons so the UI can display them
				failureReasons: result.failures.map((f) => ({
					provider: f.provider,
					error: f.error,
					httpStatus: f.httpStatus,
					retryAfterSec: f.retryAfterSec
				})),
				// also return the provider list so the UI can show which providers were tried
				triedProviders: result.providers.map((p) => p.name)
			},
			{ status: 503 }
		);
	}

	// single provider succeeded
	setCached(cacheKey, result.parsed, result.provider);

	return json(
		{ ...result.parsed, _provider: result.provider, _fallback: false, _cached: false },
		{ headers: securityHeaders }
	);
};
