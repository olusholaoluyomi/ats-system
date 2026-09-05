// callLLM/extractJSON had zero direct unit coverage before being hoisted out
// of api/analyze/+server.ts into $lib/server/llm-call.ts - this file adds it
// now that extraction made the pieces easily testable in isolation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLLM, extractJSON } from '../../../src/lib/server/llm-call';

// provider-quota is mocked (rather than exercised against its real module
// state) so these tests can assert exactly what markProviderExhausted was
// called with - the real bug this covers (2026-09-05) was that every 429 got
// treated as a full-day outage regardless of what the provider actually
// said, so the interesting assertion is "what retryAfterMs value reached
// provider-quota", not provider-quota's own internal timing (see
// provider-quota.test.ts for that).
const { isProviderExhausted, markProviderExhausted } = vi.hoisted(() => ({
	isProviderExhausted: vi.fn().mockReturnValue(false),
	markProviderExhausted: vi.fn()
}));
vi.mock('../../../src/routes/api/analyze/provider-quota', () => ({
	isProviderExhausted,
	markProviderExhausted
}));

function geminiResponse(text: string) {
	return {
		ok: true,
		status: 200,
		json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] })
	};
}

function rateLimitedResponse(opts: { retryAfterHeader?: string; body?: string } = {}) {
	return {
		ok: false,
		status: 429,
		headers: {
			get: (name: string) => (name === 'Retry-After' ? (opts.retryAfterHeader ?? null) : null)
		},
		text: async () => opts.body ?? ''
	};
}

const ENV = { GEMINI_API_KEY: 'test-key' };

afterEach(() => {
	vi.unstubAllGlobals();
	isProviderExhausted.mockClear().mockReturnValue(false);
	markProviderExhausted.mockClear();
});

describe('extractJSON', () => {
	it('parses a direct JSON string', () => {
		expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
	});

	it('strips markdown code fences', () => {
		expect(extractJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 });
	});

	it('extracts the first {...} block from surrounding prose', () => {
		expect(extractJSON('Sure, here you go: {"a":1} - hope that helps!')).toEqual({ a: 1 });
	});

	it('returns null for unparseable input', () => {
		expect(extractJSON('not json at all')).toBeNull();
	});
});

describe('callLLM', () => {
	it('returns the parsed result and provider name on success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiResponse('{"overallScore": 85}')));

		const result = await callLLM(() => 'prompt', ENV);
		expect(result).toEqual({ parsed: { overallScore: 85 }, provider: 'gemini-3.5-flash-lite' });
	});

	it('returns null when no provider is configured', async () => {
		const result = await callLLM(() => 'prompt', {});
		expect(result).toBeNull();
	});

	it('returns null when the only provider returns unparseable text', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiResponse('not json')));
		const result = await callLLM(() => 'prompt', ENV);
		expect(result).toBeNull();
	});

	it('returns null when the only provider errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' })
		);
		const result = await callLLM(() => 'prompt', ENV);
		expect(result).toBeNull();
	});

	it('calls promptFor with the provider contextBudget', async () => {
		const promptFor = vi.fn().mockReturnValue('built prompt');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiResponse('{"ok":true}')));

		await callLLM(promptFor, ENV);
		expect(promptFor).toHaveBeenCalledWith(expect.any(Number));
	});

	it('skips a provider already marked exhausted instead of calling it', async () => {
		isProviderExhausted.mockReturnValue(true);
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		const result = await callLLM(() => 'prompt', ENV);
		expect(result).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	describe('429 handling (2026-09-05 regression: every 429 was treated as a full-day outage)', () => {
		it('passes a numeric Retry-After header through as milliseconds', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(rateLimitedResponse({ retryAfterHeader: '30' }))
			);

			await callLLM(() => 'prompt', ENV);
			expect(markProviderExhausted).toHaveBeenCalledWith('gemini-3.5-flash-lite', 30_000);
		});

		it("parses Google's structured retryDelay from the error body when there is no header", async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(
					rateLimitedResponse({
						body: JSON.stringify({
							error: {
								details: [
									{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' }
								]
							}
						})
					})
				)
			);

			await callLLM(() => 'prompt', ENV);
			expect(markProviderExhausted).toHaveBeenCalledWith('gemini-3.5-flash-lite', 34_000);
		});

		it("falls back to undefined (provider-quota's own short default) when there is no hint at all - never silently assumes a full day", async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rateLimitedResponse()));

			await callLLM(() => 'prompt', ENV);
			expect(markProviderExhausted).toHaveBeenCalledWith('gemini-3.5-flash-lite', undefined);
		});
	});
});
