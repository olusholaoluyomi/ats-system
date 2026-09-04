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
	// non-AI, regex-extracted from descriptionText at ingestion time (see
	// $lib/server/job-board/experience-heuristic.ts) - null means "couldn't
	// tell", not "zero years required".
	minYearsExperience: number | null;
	maxYearsExperience: number | null;
}

export interface JobsFilters {
	remote: boolean;
	query: string | null; // trimmed, non-empty keyword search over title/company/department
	// years-of-experience range filter. null means "no bound on this side" -
	// e.g. {experienceMin: 3, experienceMax: null} means "3 years or more".
	experienceMin: number | null;
	experienceMax: number | null;
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
		firstSeenAt: toIsoString(data.firstSeenAt),
		minYearsExperience:
			typeof data.minYearsExperience === 'number' ? data.minYearsExperience : null,
		maxYearsExperience: typeof data.maxYearsExperience === 'number' ? data.maxYearsExperience : null
	};
}

// "posted 2 hours ago" style relative label, shared by the full job board
// and the landing-page preview. caps at "yesterday"/"2 days ago" - nothing
// on the board is ever older than MAX_POSTING_AGE_MS (48h) in the first
// place. kept alongside formatPostedDate below (the absolute date) rather
// than replaced by it - relative time is what's actually scannable at a
// glance in a dense card grid, the absolute date is what's unambiguous.
export function timeAgo(iso: string): string {
	const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
	if (hours < 1) return 'just now';
	if (hours === 1) return '1 hour ago';
	if (hours < 24) return `${hours} hours ago`;
	if (hours < 48) return 'yesterday';
	return '2 days ago';
}

// absolute "date posted" - e.g. "Sep 4, 2026". a relative-only label like
// "2 hours ago" tells you nothing once you've looked away and come back, or
// when comparing two postings from different browsing sessions - this is
// the unambiguous version shown alongside it.
export function formatPostedDate(iso: string): string {
	return new Date(iso).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
}

export type DescriptionBlock =
	{ type: 'paragraph'; lines: string[] } | { type: 'bullets'; lines: string[] };

const BULLET_PREFIX = /^\s*(?:[-*•]|\d+[.)])\s+/;

// splits plain description text (see html-to-text.ts - this never touches
// raw HTML, descriptionText is already-safe plain text) into paragraph vs.
// bullet-list blocks, so the detail page can render real <ul>/<li> markup
// instead of one flat wall of text. every line still goes through Svelte's
// normal {...} interpolation when rendered (auto-escaped) - this function
// only decides STRUCTURE, it never builds HTML strings or trusts anything
// beyond "does this line start with a bullet marker".
export function formatDescription(text: string): DescriptionBlock[] {
	if (!text.trim()) return [];

	const blocks: DescriptionBlock[] = [];
	// blank-line-separated chunks first, then decide each chunk's type
	const chunks = text.split(/\n{2,}/).filter((c) => c.trim());

	for (const chunk of chunks) {
		const lines = chunk
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		if (lines.length === 0) continue;

		const bulletLines = lines.filter((l) => BULLET_PREFIX.test(l));
		// a chunk counts as a bullet list only if EVERY line in it looks like
		// a bullet - a single stray dash inside a paragraph shouldn't turn the
		// whole paragraph into a one-item list.
		if (bulletLines.length === lines.length) {
			blocks.push({ type: 'bullets', lines: lines.map((l) => l.replace(BULLET_PREFIX, '')) });
		} else {
			blocks.push({ type: 'paragraph', lines });
		}
	}

	return blocks;
}

export function hasActiveFilters(filters: JobsFilters): boolean {
	return (
		filters.remote ||
		Boolean(filters.query) ||
		filters.experienceMin !== null ||
		filters.experienceMax !== null
	);
}

// a filter narrows what's shown to the TOP of the list, it never hides
// results outright - a visitor whose filters happen to match nothing still
// sees the rest of the board rather than a dead end. the experience filter
// follows the same rule: a job the heuristic couldn't extract years from
// always matches, since "couldn't tell" is not the same as "doesn't
// qualify" - only a job with a KNOWN, non-overlapping range gets excluded.
export function matchesFilters(job: JobListing, filters: JobsFilters): boolean {
	if (filters.remote && !job.remote) return false;
	if (filters.query) {
		const q = filters.query.toLowerCase();
		const haystack = `${job.title} ${job.companyName} ${job.department ?? ''}`.toLowerCase();
		if (!haystack.includes(q)) return false;
	}
	if (filters.experienceMin !== null || filters.experienceMax !== null) {
		const hasJobRange = job.minYearsExperience !== null || job.maxYearsExperience !== null;
		if (hasJobRange) {
			const jobMin = job.minYearsExperience ?? 0;
			const jobMax = job.maxYearsExperience ?? Infinity;
			const filterMin = filters.experienceMin ?? 0;
			const filterMax = filters.experienceMax ?? Infinity;
			if (jobMax < filterMin || jobMin > filterMax) return false;
		}
	}
	return true;
}
