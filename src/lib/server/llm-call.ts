// shared LLM-provider-chain caller, hoisted out of api/analyze/+server.ts so
// the job-board ingestion script (scripts/ingest-jobs.mjs, via
// job-board/classify.ts) can reuse the same battle-tested
// fallback/timeout/429-quota/messy-JSON handling that resume scoring already
// has, instead of drifting from it with a thinner reimplementation.
//
// both functions already took `env`/`promptFor` as plain parameters with no
// route-specific closure state, so this is a near-verbatim move - the
// analyze route now just imports from here.
//
// imports below are relative with explicit .ts extensions rather than the
// usual $lib alias: this module needs to run both under Vite/SvelteKit AND
// directly via `node` (from scripts/ingest-jobs.mjs, through classify.ts) -
// Node's native type-stripping only understands plain Node module
// resolution, not Vite's alias config.
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

		// Skip providers that have already exhausted their daily free-tier quota.
		// They will be automatically re-enabled at the next UTC midnight.
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
				// 429 = daily quota hit. Mark exhausted until UTC midnight so
				// every subsequent request today skips this provider immediately
				// instead of burning its full timeout retrying a depleted key.
				if (response.status === 429) {
					markProviderExhausted(provider.name);
					logWarn('llm.provider_daily_quota_hit', {
						provider: provider.name,
						message: 'marked exhausted until UTC midnight'
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
