// Greenhouse's public job board API. no auth, no API key - any company's
// board is readable at this URL as long as they haven't disabled the
// public job board (rare; most companies want it public for SEO). shape
// confirmed against a live board (gitlab) rather than assumed from memory:
// jobs live under a `jobs` array, `content` is HTML (Greenhouse never
// returns a plaintext field, unlike Lever/Ashby - hence the htmlToText pass
// here specifically).
// explicit .ts extension: this runs both under Vite AND directly via `node`
// (scripts/ingest-jobs.mjs), whose native type-stripping needs a fully
// resolvable specifier.
import { htmlToText } from '../html-to-text.ts';
import type { RawJobPosting } from '../types.ts';

const GREENHOUSE_API_BASE = 'https://boards-api.greenhouse.io/v1/boards';

export class GreenhouseError extends Error {
	readonly status: number;

	constructor(message: string, status = 502) {
		super(message);
		this.name = 'GreenhouseError';
		this.status = status;
	}
}

interface GreenhouseJob {
	id: number | string;
	title?: string;
	absolute_url?: string;
	location?: { name?: string };
	departments?: { name?: string }[];
	content?: string;
	first_published?: string;
}

interface GreenhouseResponse {
	jobs?: GreenhouseJob[];
}

// fetches every open posting on one company's Greenhouse board. throws
// GreenhouseError on a non-2xx or malformed response - the ingestion script
// catches this per-company so one board's outage never aborts the whole run.
export async function fetchGreenhouseJobs(boardToken: string): Promise<RawJobPosting[]> {
	const response = await fetch(
		`${GREENHOUSE_API_BASE}/${encodeURIComponent(boardToken)}/jobs?content=true`
	);

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new GreenhouseError(
			`greenhouse board '${boardToken}' request failed (${response.status}): ${body.slice(0, 300)}`,
			response.status
		);
	}

	const data = (await response.json().catch(() => null)) as GreenhouseResponse | null;
	if (!data || !Array.isArray(data.jobs)) {
		throw new GreenhouseError(`greenhouse board '${boardToken}' returned an unexpected shape`);
	}

	return data.jobs
		.filter((job): job is GreenhouseJob & { id: number | string; title: string } =>
			Boolean(job.id && job.title)
		)
		.map((job) => {
			const locationRaw = job.location?.name ?? '';
			return {
				externalId: String(job.id),
				title: job.title,
				department: job.departments?.[0]?.name,
				locationRaw,
				// Greenhouse has no explicit remote flag - unlike Lever/Ashby,
				// which both expose one directly (see their ats-clients).
				remote: /remote/i.test(locationRaw),
				applyUrl: job.absolute_url ?? '',
				descriptionText: job.content ? htmlToText(job.content).slice(0, 20_000) : '',
				postedAtSource: job.first_published ? new Date(job.first_published) : null
			} satisfies RawJobPosting;
		})
		.filter((job) => job.applyUrl.length > 0);
}
