// public job board list: server-rendered (not a client-side Firestore read)
// so the page is crawlable/fast for a visitor who hasn't signed in, and so
// the Firestore client SDK never ships to the bundle for this route. mirrors
// api/stats/+server.ts's defensive pattern - dynamic admin-SDK import inside
// try/catch, graceful empty-list fallback rather than a bare error page.
//
// search is a REAL Firestore query, not client-side filtering of a fixed
// batch: remote and a keyword search both narrow the query itself (see
// search-keywords.ts for why array-contains-any, and its OR-vs-AND
// tradeoff), and matchesFilters is reapplied afterward as a precision pass
// over that already-narrowed page - not a stand-in for the DB query. this
// also means every page view reads at most PAGE_SIZE+1 docs, not a fixed
// 150-doc batch regardless of what's actually being searched for.
//
// pagination is real cursor-based Firestore pagination (startAfter/
// endBefore + limitToLast), not an in-memory slice - see the ?after=/
// ?before= handling below.
import { env as privateEnv } from '$env/dynamic/private';
import { logger } from '$lib/log';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { PageServerLoad } from './$types';
import {
	type JobListing,
	type JobsFilters,
	MAX_POSTING_AGE_MS,
	mapJobDoc,
	matchesFilters,
	toIsoString
} from './shared';
import { tokenizeQuery } from '$lib/server/job-board/search-keywords';

// not exported: +page.server.ts's exports are validated by SvelteKit against
// a fixed allow-list (load/prerender/csr/ssr/trailingSlash/config/actions/
// entries, or a `_`-prefixed name) and the production build fails on
// anything else - this is used only within this file.
const PAGE_SIZE = 20;

// clamp a query-param years value to a sane bound, or null if absent/invalid
// - never trust a URL param to be a well-formed positive integer.
function parseYearsParam(raw: string | null): number | null {
	if (!raw) return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.min(Math.round(n), 40);
}

interface EmptyResult {
	jobs: JobListing[];
	filters: JobsFilters;
	hasNext: boolean;
	hasPrev: boolean;
	nextCursor: string | null;
	prevCursor: string | null;
}

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	// this page has no per-visitor state (no auth check, same result for
	// everyone hitting the same URL) and the underlying data only changes
	// when ingestion runs (every 8h, see ingest-jobs.yml) - a short edge
	// cache means repeat views of the same search/page don't re-hit
	// Firestore at all, which matters now that every read is billed per
	// document (see dedupe-and-write.ts's QUOTA BUDGET note) and page views
	// are a real, ongoing share of the daily read budget, not just ingestion.
	setHeaders({ 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=1800' });

	const rawQuery = url.searchParams.get('q')?.trim() ?? '';
	const filters: JobsFilters = {
		remote: url.searchParams.get('remote') === 'true',
		query: rawQuery.length > 0 ? rawQuery.slice(0, 100) : null,
		experienceMin: parseYearsParam(url.searchParams.get('experienceMin')),
		experienceMax: parseYearsParam(url.searchParams.get('experienceMax'))
	};
	const afterParam = url.searchParams.get('after');
	const beforeParam = url.searchParams.get('before');

	const empty: EmptyResult = {
		jobs: [],
		filters,
		hasNext: false,
		hasPrev: false,
		nextCursor: null,
		prevCursor: null
	};

	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) return empty;

		const cutoff = new Date(Date.now() - MAX_POSTING_AGE_MS);
		const queryWords = filters.query ? tokenizeQuery(filters.query) : [];

		let q = db.collection('jobs').where('active', '==', true).where('firstSeenAt', '>', cutoff);
		if (filters.remote) q = q.where('remote', '==', true);
		if (queryWords.length > 0) {
			q = q.where('searchKeywords', 'array-contains-any', queryWords);
		}
		q = q.orderBy('firstSeenAt', 'desc');

		// fetch one extra doc beyond PAGE_SIZE purely to know whether another
		// page exists in that direction - trimmed off before display, never
		// shown. see the file header comment for how hasNext/hasPrev map
		// across the three cases below.
		let docs: QueryDocumentSnapshot[];
		let hasNext: boolean;
		let hasPrev: boolean;

		if (beforeParam) {
			const snapshot = await q
				.endBefore(new Date(beforeParam))
				.limitToLast(PAGE_SIZE + 1)
				.get();
			const all = snapshot.docs;
			hasPrev = all.length > PAGE_SIZE;
			docs = hasPrev ? all.slice(all.length - PAGE_SIZE) : all;
			hasNext = true; // we navigated here from a page further forward
		} else if (afterParam) {
			const snapshot = await q
				.startAfter(new Date(afterParam))
				.limit(PAGE_SIZE + 1)
				.get();
			docs = snapshot.docs.slice(0, PAGE_SIZE);
			hasNext = snapshot.docs.length > PAGE_SIZE;
			hasPrev = true; // we navigated here from a page further back
		} else {
			const snapshot = await q.limit(PAGE_SIZE + 1).get();
			docs = snapshot.docs.slice(0, PAGE_SIZE);
			hasNext = snapshot.docs.length > PAGE_SIZE;
			hasPrev = false;
		}

		let jobs: JobListing[] = docs.map((doc) => mapJobDoc(doc.id, doc.data()));

		// precision pass: the DB query above is an OR-ish narrowing
		// (array-contains-any) plus the experience range Firestore can't
		// filter alongside it - matchesFilters re-checks all of it exactly
		// over this already-small page, same logic the job detail/
		// notification paths already trust (jobs/shared.ts).
		if (filters.query || filters.experienceMin !== null || filters.experienceMax !== null) {
			jobs = jobs.filter((j) => matchesFilters(j, filters));
		}

		// cursor values passed back through ?after=/?before= must round-trip
		// through `new Date(...)` on the next request - an ISO string does
		// that cleanly.
		const nextCursor =
			docs.length > 0 ? toIsoString(docs[docs.length - 1].data().firstSeenAt) : null;
		const prevCursor = docs.length > 0 ? toIsoString(docs[0].data().firstSeenAt) : null;

		return {
			jobs,
			filters,
			hasNext: hasNext && docs.length > 0,
			hasPrev: hasPrev && docs.length > 0,
			nextCursor,
			prevCursor
		};
	} catch (err) {
		logger.error('jobs.list_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		return empty;
	}
};
