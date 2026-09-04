// public job board list: server-rendered (not a client-side Firestore read)
// so the page is crawlable/fast for a visitor who hasn't signed in, and so
// the Firestore client SDK never ships to the bundle for this route. mirrors
// api/stats/+server.ts's defensive pattern - dynamic admin-SDK import inside
// try/catch, graceful empty-list fallback rather than a bare error page.
import { env as privateEnv } from '$env/dynamic/private';
import { logger } from '$lib/log';
import type { PageServerLoad } from './$types';
import {
	type JobListing,
	type JobsFilters,
	MAX_POSTING_AGE_MS,
	mapJobDoc,
	hasActiveFilters,
	matchesFilters
} from './shared';

export const load: PageServerLoad = async ({ url }) => {
	const rawQuery = url.searchParams.get('q')?.trim() ?? '';
	const filters: JobsFilters = {
		remote: url.searchParams.get('remote') === 'true',
		query: rawQuery.length > 0 ? rawQuery.slice(0, 100) : null
	};

	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) return { jobs: [] as JobListing[], filters, matchCount: 0 };

		const cutoff = new Date(Date.now() - MAX_POSTING_AGE_MS);
		// no equality filters here (remote/query are a soft sort preference
		// below, not a hard query gate) - filters must never make the board
		// come back empty when other roles exist.
		const snapshot = await db
			.collection('jobs')
			.where('active', '==', true)
			.where('firstSeenAt', '>', cutoff)
			.orderBy('firstSeenAt', 'desc')
			.limit(150)
			.get();

		const jobs: JobListing[] = snapshot.docs.map((doc) => mapJobDoc(doc.id, doc.data()));

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
