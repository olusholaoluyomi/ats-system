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
// intentional: cloud providers run first (Gemini, Groq, Cerebras), with Ollama
// last as a fallback. callers without any of the providers configured will see
// an empty array and the route returns 503.
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
	// Ollama is intentionally placed last as a final fallback after the cloud chain.
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
