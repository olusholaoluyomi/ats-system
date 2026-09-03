import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLeverJobs, LeverError } from '../../../src/lib/server/job-board/ats-clients/lever';

function stubFetch(overrides: { ok?: boolean; status?: number; body?: unknown } = {}) {
	const { ok = true, status = 200, body = [] } = overrides;
	const fetchMock = vi.fn().mockResolvedValue({
		ok,
		status,
		text: async () => 'err body',
		json: async () => body
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fetchLeverJobs', () => {
	it('normalizes a posting into the shared RawJobPosting shape', async () => {
		stubFetch({
			body: [
				{
					id: 'abc-123',
					text: 'Staff Product Engineer',
					categories: { location: 'Remote', team: 'Product' },
					descriptionPlain: 'Build the product.',
					hostedUrl: 'https://jobs.lever.co/acme/abc-123',
					applyUrl: 'https://jobs.lever.co/acme/abc-123/apply',
					createdAt: 1_700_000_000_000,
					workplaceType: 'remote'
				}
			]
		});

		const jobs = await fetchLeverJobs('acme');
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({
			externalId: 'abc-123',
			title: 'Staff Product Engineer',
			department: 'Product',
			locationRaw: 'Remote',
			remote: true,
			applyUrl: 'https://jobs.lever.co/acme/abc-123/apply',
			descriptionText: 'Build the product.'
		});
		expect(jobs[0].postedAtSource).toEqual(new Date(1_700_000_000_000));
	});

	it('falls back to hostedUrl when applyUrl is absent', async () => {
		stubFetch({
			body: [
				{
					id: '1',
					text: 'Role',
					hostedUrl: 'https://jobs.lever.co/acme/1',
					workplaceType: 'hybrid'
				}
			]
		});
		const jobs = await fetchLeverJobs('acme');
		expect(jobs[0].applyUrl).toBe('https://jobs.lever.co/acme/1');
		expect(jobs[0].remote).toBe(false);
	});

	it('throws LeverError when the response is not a bare array', async () => {
		stubFetch({ body: { jobs: [] } });
		await expect(fetchLeverJobs('acme')).rejects.toBeInstanceOf(LeverError);
	});

	it('throws LeverError on a non-2xx response', async () => {
		stubFetch({ ok: false, status: 404 });
		await expect(fetchLeverJobs('does-not-exist')).rejects.toBeInstanceOf(LeverError);
	});
});
