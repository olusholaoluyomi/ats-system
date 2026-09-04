// Lever's public postings API. no auth, no API key. shape confirmed against
// a live board (palantir) rather than assumed from memory: the response is
// a BARE array (not wrapped in an object), and it already provides
// `descriptionPlain` alongside the HTML `description`, so no HTML stripping
// is needed here (unlike Greenhouse). `workplaceType` is a direct
// remote/hybrid/onsite signal - more reliable than string-matching location text.
import type { RawJobPosting } from '../types.ts';

const LEVER_API_BASE = 'https://api.lever.co/v0/postings';

export class LeverError extends Error {
	readonly status: number;

	constructor(message: string, status = 502) {
		super(message);
		this.name = 'LeverError';
		this.status = status;
	}
}

interface LeverPosting {
	id?: string;
	text?: string;
	categories?: { location?: string; team?: string };
	descriptionPlain?: string;
	hostedUrl?: string;
	applyUrl?: string;
	createdAt?: number;
	workplaceType?: string;
}

// fetches every open posting on one company's Lever board. throws LeverError
// on a non-2xx or malformed response - the ingestion script catches this
// per-company so one board's outage never aborts the whole run.
export async function fetchLeverJobs(boardToken: string): Promise<RawJobPosting[]> {
	const response = await fetch(`${LEVER_API_BASE}/${encodeURIComponent(boardToken)}?mode=json`);

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new LeverError(
			`lever board '${boardToken}' request failed (${response.status}): ${body.slice(0, 300)}`,
			response.status
		);
	}

	const data = (await response.json().catch(() => null)) as LeverPosting[] | null;
	if (!Array.isArray(data)) {
		throw new LeverError(`lever board '${boardToken}' returned an unexpected shape`);
	}

	return data
		.filter((job): job is LeverPosting & { id: string; text: string } =>
			Boolean(job.id && job.text)
		)
		.map((job) => {
			const applyUrl = job.applyUrl ?? job.hostedUrl ?? '';
			return {
				externalId: job.id,
				title: job.text,
				department: job.categories?.team,
				locationRaw: job.categories?.location ?? '',
				remote: job.workplaceType === 'remote',
				applyUrl,
				descriptionText: (job.descriptionPlain ?? '').slice(0, 20_000),
				postedAtSource: typeof job.createdAt === 'number' ? new Date(job.createdAt) : null,
				workplaceTypeRaw: job.workplaceType ?? null
			} satisfies RawJobPosting;
		})
		.filter((job) => job.applyUrl.length > 0);
}
