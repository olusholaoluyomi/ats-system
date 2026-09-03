import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockIncr = vi.fn();
const mockPexpire = vi.fn();
const mockPttl = vi.fn();

vi.mock('@upstash/redis', () => ({
	// a real class (or `function`), not an arrow function - `new` on an arrow
	// function always throws "is not a constructor", plain JS semantics.
	Redis: vi.fn().mockImplementation(function (this: {
		incr: typeof mockIncr;
		pexpire: typeof mockPexpire;
		pttl: typeof mockPttl;
	}) {
		this.incr = mockIncr;
		this.pexpire = mockPexpire;
		this.pttl = mockPttl;
	})
}));

import {
	distributedIncrement,
	isDistributedConfigured,
	_resetDistributedCounterClientForTests
} from '$lib/server/distributed-counter';

const CONFIGURED_ENV = {
	UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
	UPSTASH_REDIS_REST_TOKEN: 'test-token'
};

beforeEach(() => {
	vi.clearAllMocks();
	_resetDistributedCounterClientForTests();
});

describe('isDistributedConfigured', () => {
	it('is false when the env vars are absent', () => {
		expect(isDistributedConfigured({})).toBe(false);
	});

	it('is false when only one of the two env vars is set', () => {
		expect(isDistributedConfigured({ UPSTASH_REDIS_REST_URL: 'https://x' })).toBe(false);
	});

	it('is true when both env vars are set', () => {
		expect(isDistributedConfigured(CONFIGURED_ENV)).toBe(true);
	});
});

describe('distributedIncrement', () => {
	it('returns null when not configured, without touching Redis', async () => {
		const result = await distributedIncrement({}, 'key', 60_000);
		expect(result).toBeNull();
		expect(mockIncr).not.toHaveBeenCalled();
	});

	it('sets expiry on the first increment in a window', async () => {
		mockIncr.mockResolvedValue(1);
		const result = await distributedIncrement(CONFIGURED_ENV, 'key', 60_000);
		expect(result).toEqual({ count: 1, retryAfterSec: 60 });
		expect(mockPexpire).toHaveBeenCalledWith('key', 60_000);
		expect(mockPttl).not.toHaveBeenCalled();
	});

	it('reads the remaining TTL on subsequent increments instead of resetting it', async () => {
		mockIncr.mockResolvedValue(5);
		mockPttl.mockResolvedValue(15_000);
		const result = await distributedIncrement(CONFIGURED_ENV, 'key', 60_000);
		expect(result).toEqual({ count: 5, retryAfterSec: 15 });
		expect(mockPexpire).not.toHaveBeenCalled();
	});

	it('falls back to the full window when PTTL reports no expiry (-1/-2)', async () => {
		mockIncr.mockResolvedValue(3);
		mockPttl.mockResolvedValue(-1);
		const result = await distributedIncrement(CONFIGURED_ENV, 'key', 60_000);
		expect(result).toEqual({ count: 3, retryAfterSec: 60 });
	});

	it('returns null (never throws) when Redis is unreachable', async () => {
		mockIncr.mockRejectedValue(new Error('ECONNRESET'));
		const result = await distributedIncrement(CONFIGURED_ENV, 'key', 60_000);
		expect(result).toBeNull();
	});
});
