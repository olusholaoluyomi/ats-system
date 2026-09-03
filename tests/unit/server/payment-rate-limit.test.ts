import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockIncr = vi.fn();
const mockPexpire = vi.fn();
const mockPttl = vi.fn();

vi.mock('@upstash/redis', () => ({
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

import { checkPaymentRateLimit, PAYMENT_RATE_LIMIT_CONFIG } from '$lib/server/payment-rate-limit';
import { _resetDistributedCounterClientForTests } from '$lib/server/distributed-counter';

const CONFIGURED_ENV = {
	UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
	UPSTASH_REDIS_REST_TOKEN: 'test-token'
};

let ipCounter = 0;
const uniqueIp = () => `10.1.0.${(++ipCounter % 255) + 1}-${Date.now()}`;

beforeEach(() => {
	vi.clearAllMocks();
	_resetDistributedCounterClientForTests();
});

describe('checkPaymentRateLimit: local fallback (no distributed backend)', () => {
	it('allows requests under the per-minute cap', async () => {
		const result = await checkPaymentRateLimit({}, 'initialize', uniqueIp());
		expect(result.allowed).toBe(true);
	});

	it('blocks the request after MAX_RPM within one action+ip', async () => {
		const ip = uniqueIp();
		for (let i = 0; i < PAYMENT_RATE_LIMIT_CONFIG.MAX_RPM; i++) {
			await checkPaymentRateLimit({}, 'initialize', ip);
		}
		const result = await checkPaymentRateLimit({}, 'initialize', ip);
		expect(result.allowed).toBe(false);
	});

	it('keeps each action on its own budget for the same IP', async () => {
		const ip = uniqueIp();
		for (let i = 0; i < PAYMENT_RATE_LIMIT_CONFIG.MAX_RPM; i++) {
			await checkPaymentRateLimit({}, 'initialize', ip);
		}
		expect((await checkPaymentRateLimit({}, 'initialize', ip)).allowed).toBe(false);
		// 'verify' on the same IP is untouched - own budget
		expect((await checkPaymentRateLimit({}, 'verify', ip)).allowed).toBe(true);
	});
});

describe('checkPaymentRateLimit: distributed backend configured', () => {
	it('blocks once the distributed counter exceeds MAX_RPM', async () => {
		mockIncr.mockResolvedValue(PAYMENT_RATE_LIMIT_CONFIG.MAX_RPM + 1);
		mockPttl.mockResolvedValue(30_000);
		const result = await checkPaymentRateLimit(CONFIGURED_ENV, 'initialize', uniqueIp());
		expect(result.allowed).toBe(false);
		if (!result.allowed) expect(result.reason).toBe('minute');
	});

	it('allows when the distributed counter is under the cap', async () => {
		mockIncr.mockResolvedValue(1);
		const result = await checkPaymentRateLimit(CONFIGURED_ENV, 'initialize', uniqueIp());
		expect(result.allowed).toBe(true);
	});
});
