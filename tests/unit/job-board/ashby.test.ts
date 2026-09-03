import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAshbyJobs, AshbyError } from '../../../src/lib/server/job-board/ats-clients/ashby';

function stubFetch(overrides: { ok?: boolean; status?: number; body?: unknown } = {}) {
	const { ok = true, status = 200, body = { jobs: [] } } = overrides;
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

describe('fetchAshbyJobs', () => {
	it('normalizes a job into the shared RawJobPosting shape', async () => {
		stubFetch({
			body: {
				jobs: [
					{
						id: 'uuid-1',
						title: 'Engineering Manager - EU',
						department: 'Engineering',
						location: 'Remote - European Union',
						isRemote: true,
						isListed: true,
						applyUrl: 'https://jobs.ashbyhq.com/acme/uuid-1',
						descriptionPlain: 'Lead the EU team.',
						publishedAt: '2024-03-04T14:29:08.532+00:00'
					}
				]
			}
		});

		const jobs = await fetchAshbyJobs('acme');
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({
			externalId: 'uuid-1',
			title: 'Engineering Manager - EU',
			department: 'Engineering',
			locationRaw: 'Remote - European Union',
			remote: true,
			applyUrl: 'https://jobs.ashbyhq.com/acme/uuid-1',
			descriptionText: 'Lead the EU team.'
		});
		expect(jobs[0].postedAtSource).toBeInstanceOf(Date);
	});

	it('excludes jobs explicitly marked unlisted', async () => {
		stubFetch({
			body: { jobs: [{ id: '1', title: 'Hidden', isListed: false, applyUrl: 'https://x/1' }] }
		});
		const jobs = await fetchAshbyJobs('acme');
		expect(jobs).toHaveLength(0);
	});

	it('treats a missing isRemote as not remote', async () => {
		stubFetch({
			body: { jobs: [{ id: '1', title: 'Role', applyUrl: 'https://x/1', location: 'NYC' }] }
		});
		const jobs = await fetchAshbyJobs('acme');
		expect(jobs[0].remote).toBe(false);
	});

	it('throws AshbyError on a non-2xx response', async () => {
		stubFetch({ ok: false, status: 404 });
		await expect(fetchAshbyJobs('does-not-exist')).rejects.toBeInstanceOf(AshbyError);
	});

	it('throws AshbyError on an unexpected response shape', async () => {
		stubFetch({ body: [] });
		await expect(fetchAshbyJobs('acme')).rejects.toBeInstanceOf(AshbyError);
	});
});
