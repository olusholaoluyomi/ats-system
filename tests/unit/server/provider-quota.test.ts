import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// quotaState is a module-level Map, so each test gets a fresh module instance
// via resetModules + a dynamic re-import - same pattern as
// tests/unit/stores/profile-local.test.ts's freshStore().
async function freshQuotaModule() {
	vi.resetModules();
	return import('../../../src/routes/api/analyze/provider-quota');
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('provider-quota', () => {
	it('a provider is not exhausted until marked', async () => {
		const { isProviderExhausted } = await freshQuotaModule();
		expect(isProviderExhausted('gemini')).toBe(false);
	});

	it('honors an explicit retryAfterMs instead of blocking until midnight', async () => {
		const { isProviderExhausted, markProviderExhausted } = await freshQuotaModule();
		markProviderExhausted('gemini', 30_000); // a real per-minute rate limit, not a daily outage

		expect(isProviderExhausted('gemini')).toBe(true);
		vi.advanceTimersByTime(29_000);
		expect(isProviderExhausted('gemini')).toBe(true);
		vi.advanceTimersByTime(2_000);
		// past the 30s window - re-enabled well before midnight, unlike the
		// pre-fix behavior that blocked every user until UTC midnight on any
		// 429 regardless of what the provider actually said.
		expect(isProviderExhausted('gemini')).toBe(false);
	});

	it('falls back to a short default backoff (not a full day) when the provider gives no retry hint', async () => {
		const { isProviderExhausted, markProviderExhausted } = await freshQuotaModule();
		markProviderExhausted('groq'); // no retryAfterMs - provider sent no hint at all

		expect(isProviderExhausted('groq')).toBe(true);
		// well past any reasonable default backoff, well short of midnight
		// (12h away from the fixed system time above) - proves this isn't
		// silently falling through to the old "block until UTC midnight"
		// behavior.
		vi.advanceTimersByTime(10 * 60 * 1000);
		expect(isProviderExhausted('groq')).toBe(false);
	});

	it('caps an oversized retryAfterMs at the next UTC midnight', async () => {
		const { isProviderExhausted, markProviderExhausted } = await freshQuotaModule();
		// system time is noon UTC, so midnight is 12h away - a 48h retry hint
		// must never lock every user out for two days.
		markProviderExhausted('gemini', 48 * 60 * 60 * 1000);

		vi.advanceTimersByTime(13 * 60 * 60 * 1000); // 13h later - past midnight
		expect(isProviderExhausted('gemini')).toBe(false);
	});

	it('is idempotent: a second mark while already exhausted does not extend the window', async () => {
		const { isProviderExhausted, markProviderExhausted } = await freshQuotaModule();
		markProviderExhausted('gemini', 10_000);
		markProviderExhausted('gemini', 10 * 60 * 1000); // should be ignored - already exhausted

		vi.advanceTimersByTime(11_000);
		expect(isProviderExhausted('gemini')).toBe(false);
	});

	it('tracks providers independently', async () => {
		const { isProviderExhausted, markProviderExhausted } = await freshQuotaModule();
		markProviderExhausted('gemini', 60_000);
		expect(isProviderExhausted('gemini')).toBe(true);
		expect(isProviderExhausted('groq')).toBe(false);
	});

	it('getQuotaState reports only currently-exhausted providers', async () => {
		const { markProviderExhausted, getQuotaState } = await freshQuotaModule();
		markProviderExhausted('gemini', 60_000);
		const state = getQuotaState();
		expect(state.gemini).toBeDefined();
		expect(state.groq).toBeUndefined();
	});
});
