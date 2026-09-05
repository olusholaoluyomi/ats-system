// shared LLM-provider-chain caller, hoisted out of api/analyze/+server.ts and
// unit-tested in isolation (tests/unit/server/llm-call.test.ts) instead of
// only being exercised indirectly through the route handler.
//
// both functions already took `env`/`promptFor` as plain parameters with no
// route-specific closure state, so this is a near-verbatim move - the
// analyze route now just imports from here.
//
// imports below are relative with explicit .ts extensions rather than the
// usual $lib alias: this module was originally shared with a plain-`node`
// job-board ingestion script (since removed - see the job-board classify.ts
// deletion) and the relative-import style was never reverted since it works
// identically under Vite/SvelteKit.
import { buildProviders } from '../../routes/api/analyze/providers.ts';
import {
	isProviderExhausted,
	markProviderExhausted
} from '../../routes/api/analyze/provider-quota.ts';

// $lib/log.ts's own logger can't be reused here for the same dual-context
// reason as the imports above: it imports $app/environment, a Vite-injected
// virtual module with no real file on disk - no relative path can fix that,
// it simply does not resolve outside Vite. this replicates just its
// server-side shape (one JSON record per line via console.warn), which is
// what this module would get from it anyway (it never runs in a browser).
function logWarn(event: string, fields: Record<string, unknown>): void {
	console.warn(JSON.stringify({ level: 'warn', event, ts: new Date().toISOString(), ...fields }));
}

// extracts how long a 429 response says to back off, in ms - checked in two
// places since providers disagree on where they put this. Groq/OpenAI-
// compatible APIs send a standard `Retry-After` header (seconds, or
// occasionally an HTTP date). Google's Generative Language API instead
// embeds it in the JSON error body as a RetryInfo detail, e.g.
// `{"error":{"details":[{"@type":".../RetryInfo","retryDelay":"34s"}]}}`.
// returns null (not a default) when neither is present, so the caller can
// tell "provider told us nothing" apart from "provider said 0s".
function parseRetryAfterMs(headerValue: string | null, errBody: string): number | null {
	if (headerValue) {
		const seconds = Number(headerValue);
		if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
		const asDate = Date.parse(headerValue);
		if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
	}
	try {
		const parsed = JSON.parse(errBody) as {
			error?: { details?: { '@type'?: string; retryDelay?: string }[] };
		};
		const retryInfo = parsed.error?.details?.find((d) => d.retryDelay);
		const match = retryInfo?.retryDelay?.match(/^([\d.]+)s$/);
		if (match) return Math.round(Number(match[1]) * 1000);
	} catch {
		// error body wasn't JSON, or didn't have the expected shape - fine,
		// the caller falls back to the default backoff.
	}
	return null;
}

// tries each provider in sequence until one succeeds and returns valid JSON.
// promptFor is called once per provider with that provider's own
// contextBudget, so Gemini (huge context window) gets a near-complete
// resume while Claude/Groq (kept deliberately small - cost-per-call for
// Claude, a tight free-tier TPM ceiling for Groq) still get the smaller,
// section-prioritized slice they need to stay under their limits.
// Building lazily per-provider (rather than once up front) also means a
// provider that's skipped for missing credentials never pays the cost of
// having a prompt built for it.
export async function callLLM(
	promptFor: (contextBudget: number) => string,
	env: Record<string, string>
): Promise<{ parsed: Record<string, unknown>; provider: string } | null> {
	const providers = buildProviders(env);
	for (const provider of providers) {
		const secret = env[provider.configKey] ?? '';
		if (!secret) continue;

		// Skip providers currently backed off from a recent 429 - re-enabled
		// as soon as their own Retry-After window passes (or a short default,
		// or UTC midnight at the latest - see provider-quota.ts).
		if (isProviderExhausted(provider.name)) {
			logWarn('llm.provider_quota_exhausted', { provider: provider.name });
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
				logWarn('llm.provider_http_error', {
					provider: provider.name,
					status: response.status,
					errorPreview: errBody.slice(0, 300)
				});
				// 429 = rate-limited or quota-exhausted, but the two look
				// identical without a hint from the provider - honor its own
				// Retry-After/retryDelay when it sends one, otherwise back off
				// for a short default rather than assuming a full-day outage
				// (see provider-quota.ts's own comment for why that distinction
				// matters).
				if (response.status === 429) {
					const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'), errBody);
					markProviderExhausted(provider.name, retryAfterMs ?? undefined);
					logWarn('llm.provider_rate_limited', {
						provider: provider.name,
						retryAfterMs: retryAfterMs ?? 'unspecified (using default backoff)'
					});
				}
				continue;
			}

			const data = await response.json();
			const text = provider.extractText(data);

			if (!text) {
				logWarn('llm.provider_empty_text', { provider: provider.name });
				continue;
			}

			// validate JSON before accepting this provider's response
			const parsed = extractJSON(text);
			if (!parsed || typeof parsed !== 'object') {
				logWarn('llm.provider_unparseable_json', { provider: provider.name });
				continue;
			}

			return { parsed: parsed as Record<string, unknown>, provider: provider.name };
		} catch (err) {
			const isTimeout = err instanceof DOMException && err.name === 'AbortError';
			logWarn(isTimeout ? 'llm.provider_timeout' : 'llm.provider_failed', {
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
export function extractJSON(raw: string): unknown {
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
