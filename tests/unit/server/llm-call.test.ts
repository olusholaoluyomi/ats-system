// callLLM/extractJSON had zero direct unit coverage before being hoisted out
// of api/analyze/+server.ts into $lib/server/llm-call.ts - this file adds it
// now that extraction made the pieces easily testable in isolation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLLM, extractJSON } from '../../../src/lib/server/llm-call';

function geminiResponse(text: string) {
	return {
		ok: true,
		status: 200,
		json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] })
	};
}

const ENV = { GEMINI_API_KEY: 'test-key' };

afterEach(() => {
	vi.unstubAllGlobals();
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
});
