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

import { checkJDAnalysisQuota, JD_ANALYSIS_QUOTA_CONFIG } from '$lib/server/jd-analysis-quota';
import { _resetDistributedCounterClientForTests } from '$lib/server/distributed-counter';

const CONFIGURED_ENV = {
	UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
	UPSTASH_REDIS_REST_TOKEN: 'test-token'
};

let uidCounter = 0;
const uniqueUid = () => `uid-${++uidCounter}-${Date.now()}`;

beforeEach(() => {
	vi.clearAllMocks();
	_resetDistributedCounterClientForTests();
});

describe('checkJDAnalysisQuota: local fallback (no distributed backend)', () => {
	it('allows requests under the daily cap', async () => {
		expect((await checkJDAnalysisQuota({}, uniqueUid())).allowed).toBe(true);
	});

	it('blocks after MAX_PER_DAY calls for the same account', async () => {
		const uid = uniqueUid();
		for (let i = 0; i < JD_ANALYSIS_QUOTA_CONFIG.MAX_PER_DAY; i++) {
			await checkJDAnalysisQuota({}, uid);
		}
		const result = await checkJDAnalysisQuota({}, uid);
		expect(result.allowed).toBe(false);
	});

	it('treats different accounts independently', async () => {
		const a = uniqueUid();
		const b = uniqueUid();
		for (let i = 0; i < JD_ANALYSIS_QUOTA_CONFIG.MAX_PER_DAY; i++)
			await checkJDAnalysisQuota({}, a);
		expect((await checkJDAnalysisQuota({}, a)).allowed).toBe(false);
		expect((await checkJDAnalysisQuota({}, b)).allowed).toBe(true);
	});
});

describe('checkJDAnalysisQuota: distributed backend configured', () => {
	it('blocks once the distributed counter exceeds MAX_PER_DAY', async () => {
		mockIncr.mockResolvedValue(JD_ANALYSIS_QUOTA_CONFIG.MAX_PER_DAY + 1);
		mockPttl.mockResolvedValue(3_600_000);
		const result = await checkJDAnalysisQuota(CONFIGURED_ENV, uniqueUid());
		expect(result.allowed).toBe(false);
	});

	it('allows when the distributed counter is under the cap', async () => {
		mockIncr.mockResolvedValue(1);
		const result = await checkJDAnalysisQuota(CONFIGURED_ENV, uniqueUid());
		expect(result.allowed).toBe(true);
	});
});
