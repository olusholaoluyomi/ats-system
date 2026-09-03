// types + pure logic shared between +page.server.ts, [id]/+page.server.ts,
// and their tests. deliberately NOT in +page.server.ts itself: SvelteKit
// validates every export of a +page.server.ts against a fixed allow-list
// (load/prerender/csr/ssr/trailingSlash/config/actions/entries, or a
// `_`-prefixed name) and fails the production build on anything else -
// caught by Vercel's build (svelte-kit's postbuild analysis), not by
// svelte-check/vitest/eslint, none of which run that check.

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
	query: string | null; // trimmed, non-empty keyword search over title/company
}

// hard cutoff: a posting older than this never appears on the board, full
// stop, regardless of whether it's still `active` on its source's board.
export const MAX_POSTING_AGE_MS = 48 * 60 * 60 * 1000;

export function toIsoString(value: unknown): string {
	if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
		return (value as { toDate: () => Date }).toDate().toISOString();
	}
	if (value instanceof Date) return value.toISOString();
	return new Date(0).toISOString();
}

export function hasActiveFilters(filters: JobsFilters): boolean {
	return (
		filters.remote ||
		filters.relocation ||
		Boolean(filters.experienceLevel) ||
		Boolean(filters.query)
	);
}

// a filter narrows what's shown to the TOP of the list, it never hides
// results outright - a visitor whose filters happen to match nothing still
// sees the rest of the board rather than a dead end.
export function matchesFilters(job: JobListing, filters: JobsFilters): boolean {
	if (filters.remote && !job.remote) return false;
	if (filters.relocation && job.classification?.relocationOffered !== true) return false;
	if (filters.experienceLevel && job.classification?.experienceLevel !== filters.experienceLevel) {
		return false;
	}
	if (filters.query) {
		const q = filters.query.toLowerCase();
		const haystack = `${job.title} ${job.companyName} ${job.department ?? ''}`.toLowerCase();
		if (!haystack.includes(q)) return false;
	}
	return true;
}
