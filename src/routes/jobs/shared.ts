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
}

export interface JobsFilters {
	remote: boolean;
	query: string | null; // trimmed, non-empty keyword search over title/company/department
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

// shared Firestore doc -> JobListing mapping, used by both the full job
// board (jobs/+page.server.ts) and the landing-page preview
// (routes/+page.server.ts) so the two never drift out of sync on field
// shape. takes plain (id, data) rather than a Firestore snapshot type so
// this module stays decoupled from firebase-admin's types.
export function mapJobDoc(id: string, data: Record<string, unknown>): JobListing {
	return {
		id,
		companyName: typeof data.companyName === 'string' ? data.companyName : '',
		title: typeof data.title === 'string' ? data.title : '',
		department: typeof data.department === 'string' ? data.department : null,
		locationRaw: typeof data.locationRaw === 'string' ? data.locationRaw : '',
		remote: data.remote === true,
		applyUrl: typeof data.applyUrl === 'string' ? data.applyUrl : '',
		whyThisCompany: typeof data.whyThisCompany === 'string' ? data.whyThisCompany : null,
		firstSeenAt: toIsoString(data.firstSeenAt)
	};
}

// "posted 2 hours ago" style relative label, shared by the full job board
// and the landing-page preview. caps at "yesterday"/"2 days ago" - nothing
// on the board is ever older than MAX_POSTING_AGE_MS (48h) in the first
// place.
export function timeAgo(iso: string): string {
	const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
	if (hours < 1) return 'just now';
	if (hours === 1) return '1 hour ago';
	if (hours < 24) return `${hours} hours ago`;
	if (hours < 48) return 'yesterday';
	return '2 days ago';
}

export function hasActiveFilters(filters: JobsFilters): boolean {
	return filters.remote || Boolean(filters.query);
}

// a filter narrows what's shown to the TOP of the list, it never hides
// results outright - a visitor whose filters happen to match nothing still
// sees the rest of the board rather than a dead end.
export function matchesFilters(job: JobListing, filters: JobsFilters): boolean {
	if (filters.remote && !job.remote) return false;
	if (filters.query) {
		const q = filters.query.toLowerCase();
		const haystack = `${job.title} ${job.companyName} ${job.department ?? ''}`.toLowerCase();
		if (!haystack.includes(q)) return false;
	}
	return true;
}
