import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fetchGreenhouseJobs,
	GreenhouseError
} from '../../../src/lib/server/job-board/ats-clients/greenhouse';

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

describe('fetchGreenhouseJobs', () => {
	it('normalizes a job into the shared RawJobPosting shape', async () => {
		stubFetch({
			body: {
				jobs: [
					{
						id: 12345,
						title: 'Senior Backend Engineer',
						absolute_url: 'https://boards.greenhouse.io/acme/jobs/12345',
						location: { name: 'Remote - Worldwide' },
						departments: [{ name: 'Engineering' }],
						content: '<p>Build things.</p><p>Remote OK.</p>',
						first_published: '2024-01-01T00:00:00-05:00'
					}
				]
			}
		});

		const jobs = await fetchGreenhouseJobs('acme');
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({
			externalId: '12345',
			title: 'Senior Backend Engineer',
			department: 'Engineering',
			locationRaw: 'Remote - Worldwide',
			remote: true,
			applyUrl: 'https://boards.greenhouse.io/acme/jobs/12345'
		});
		expect(jobs[0].descriptionText).toContain('Build things.');
		expect(jobs[0].postedAtSource).toBeInstanceOf(Date);
	});

	it('does not flag an onsite-only role as remote', async () => {
		stubFetch({
			body: {
				jobs: [
					{
						id: 1,
						title: 'Office Manager',
						absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
						location: { name: 'San Francisco, CA' },
						content: '<p>Come to the office.</p>'
					}
				]
			}
		});
		const jobs = await fetchGreenhouseJobs('acme');
		expect(jobs[0].remote).toBe(false);
	});

	it('drops jobs with no apply URL', async () => {
		stubFetch({ body: { jobs: [{ id: 1, title: 'No URL', location: {} }] } });
		const jobs = await fetchGreenhouseJobs('acme');
		expect(jobs).toHaveLength(0);
	});

	it('throws GreenhouseError on a non-2xx response, without aborting other companies', async () => {
		stubFetch({ ok: false, status: 404 });
		await expect(fetchGreenhouseJobs('does-not-exist')).rejects.toBeInstanceOf(GreenhouseError);
	});

	it('throws GreenhouseError on an unexpected response shape', async () => {
		stubFetch({ body: { unexpected: true } });
		await expect(fetchGreenhouseJobs('acme')).rejects.toBeInstanceOf(GreenhouseError);
	});
});
