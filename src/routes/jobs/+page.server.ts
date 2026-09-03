// public job board list: server-rendered (not a client-side Firestore read)
// so the page is crawlable/fast for a visitor who hasn't signed in, and so
// the Firestore client SDK never ships to the bundle for this route. mirrors
// api/stats/+server.ts's defensive pattern - dynamic admin-SDK import inside
// try/catch, graceful empty-list fallback rather than a bare error page.
import { env as privateEnv } from '$env/dynamic/private';
import { logger } from '$lib/log';
import type { PageServerLoad } from './$types';

// hard cutoff: a posting older than this never appears on the board, full
// stop, regardless of whether it's still `active` on its source's board.
export const MAX_POSTING_AGE_MS = 48 * 60 * 60 * 1000;

export interface JobListing {
	id: string;
	companyName: string;
	title: string;
	department: string | null;
	locationRaw: string;
	remote: boolean;
	applyUrl: string;
	whyThisCompany: string | null;
	firstSeenAt: string; // ISO string
	classification: {
		africaRemoteFriendly: boolean;
		relocationOffered: boolean | 'unclear';
		relocationRequired: boolean;
		experienceLevel: string;
		minYearsExperience: number | null;
		maxYearsExperience: number | null;
		salaryMin: number | null;
		salaryMax: number | null;
		salaryCurrency: string | null;
		salaryPeriod: string | null;
	} | null;
}

export interface JobsFilters {
	remote: boolean;
	relocation: boolean;
	experienceLevel: string | null;
}

function toIsoString(value: unknown): string {
	if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
		return (value as { toDate: () => Date }).toDate().toISOString();
	}
	if (value instanceof Date) return value.toISOString();
	return new Date(0).toISOString();
}

function hasActiveFilters(filters: JobsFilters): boolean {
	return filters.remote || filters.relocation || Boolean(filters.experienceLevel);
}

// a filter narrows what's shown to the TOP of the list, it never hides
// results outright - a visitor whose filters happen to match nothing still
// sees the rest of the board rather than a dead end. see matchesFilters/sort
// below.
export function matchesFilters(job: JobListing, filters: JobsFilters): boolean {
	if (filters.remote && !job.remote) return false;
	if (filters.relocation && job.classification?.relocationOffered !== true) return false;
	if (filters.experienceLevel && job.classification?.experienceLevel !== filters.experienceLevel) {
		return false;
	}
	return true;
}

export const load: PageServerLoad = async ({ url }) => {
	const filters: JobsFilters = {
		remote: url.searchParams.get('remote') === 'true',
		relocation: url.searchParams.get('relocation') === 'true',
		experienceLevel: url.searchParams.get('experienceLevel')
	};

	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) return { jobs: [] as JobListing[], filters, matchCount: 0 };

		const cutoff = new Date(Date.now() - MAX_POSTING_AGE_MS);
		// no equality filters here (remote/relocation/experienceLevel are a
		// soft sort preference below, not a hard query gate) - filters must
		// never make the board come back empty when other roles exist.
		const snapshot = await db
			.collection('jobs')
			.where('active', '==', true)
			.where('firstSeenAt', '>', cutoff)
			.orderBy('firstSeenAt', 'desc')
			.limit(150)
			.get();

		const jobs: JobListing[] = snapshot.docs.map((doc) => {
			const data = doc.data();
			return {
				id: doc.id,
				companyName: typeof data.companyName === 'string' ? data.companyName : '',
				title: typeof data.title === 'string' ? data.title : '',
				department: typeof data.department === 'string' ? data.department : null,
				locationRaw: typeof data.locationRaw === 'string' ? data.locationRaw : '',
				remote: data.remote === true,
				applyUrl: typeof data.applyUrl === 'string' ? data.applyUrl : '',
				whyThisCompany: typeof data.whyThisCompany === 'string' ? data.whyThisCompany : null,
				firstSeenAt: toIsoString(data.firstSeenAt),
				classification: data.classification ?? null
			};
		});

		let matchCount = jobs.length;
		if (hasActiveFilters(filters)) {
			// stable sort: matches first, each group keeps its firstSeenAt-desc
			// order from the query above.
			const matches = jobs.filter((j) => matchesFilters(j, filters));
			const rest = jobs.filter((j) => !matchesFilters(j, filters));
			matchCount = matches.length;
			return { jobs: [...matches, ...rest], filters, matchCount };
		}

		return { jobs, filters, matchCount };
	} catch (err) {
		logger.error('jobs.list_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		return { jobs: [] as JobListing[], filters, matchCount: 0 };
	}
};
