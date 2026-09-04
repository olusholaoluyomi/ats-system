// Ashby's public job board API. no auth, no API key. shape confirmed against
// a live board (ashby's own) rather than assumed from memory: response is an
// object with a `jobs` array, and each job already carries a direct
// `isRemote` boolean (the cleanest remote signal of the three ATS sources -
// Greenhouse has none, Lever's workplaceType is closest) plus a
// `descriptionPlain` field, so no HTML stripping is needed here either.
import type { RawJobPosting } from '../types.ts';

const ASHBY_API_BASE = 'https://api.ashbyhq.com/posting-api/job-board';

export class AshbyError extends Error {
	readonly status: number;

	constructor(message: string, status = 502) {
		super(message);
		this.name = 'AshbyError';
		this.status = status;
	}
}

interface AshbyJob {
	id?: string;
	title?: string;
	department?: string;
	location?: string;
	isRemote?: boolean;
	isListed?: boolean;
	applyUrl?: string;
	jobUrl?: string;
	descriptionPlain?: string;
	publishedAt?: string;
	workplaceType?: string;
}

interface AshbyResponse {
	jobs?: AshbyJob[];
}

// fetches every open, listed posting on one company's Ashby board. throws
// AshbyError on a non-2xx or malformed response - the ingestion script
// catches this per-company so one board's outage never aborts the whole run.
export async function fetchAshbyJobs(boardToken: string): Promise<RawJobPosting[]> {
	const response = await fetch(`${ASHBY_API_BASE}/${encodeURIComponent(boardToken)}`);

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new AshbyError(
			`ashby board '${boardToken}' request failed (${response.status}): ${body.slice(0, 300)}`,
			response.status
		);
	}

	const data = (await response.json().catch(() => null)) as AshbyResponse | null;
	if (!data || !Array.isArray(data.jobs)) {
		throw new AshbyError(`ashby board '${boardToken}' returned an unexpected shape`);
	}

	return data.jobs
		.filter(
			(job): job is AshbyJob & { id: string; title: string } =>
				Boolean(job.id && job.title) && job.isListed !== false
		)
		.map((job) => {
			const applyUrl = job.applyUrl ?? job.jobUrl ?? '';
			return {
				externalId: job.id,
				title: job.title,
				department: job.department,
				locationRaw: job.location ?? '',
				remote: job.isRemote === true,
				applyUrl,
				descriptionText: (job.descriptionPlain ?? '').slice(0, 20_000),
				postedAtSource: job.publishedAt ? new Date(job.publishedAt) : null,
				workplaceTypeRaw: job.workplaceType ?? null
			} satisfies RawJobPosting;
		})
		.filter((job) => job.applyUrl.length > 0);
}
