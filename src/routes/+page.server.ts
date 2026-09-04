// landing-page job board teaser: a handful of the most recent live postings
// so a first-time visitor sees this is a real, active job board - not just a
// resume scorer. mirrors jobs/+page.server.ts's defensive pattern (dynamic
// admin-SDK import inside try/catch, graceful empty fallback); full
// browsing/filtering/search lives on /jobs.
import { env as privateEnv } from '$env/dynamic/private';
import { logger } from '$lib/log';
import type { PageServerLoad } from './$types';
import { type JobListing, MAX_POSTING_AGE_MS, mapJobDoc } from './jobs/shared';

const PREVIEW_LIMIT = 3;

export const load: PageServerLoad = async () => {
	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) return { previewJobs: [] as JobListing[] };

		const cutoff = new Date(Date.now() - MAX_POSTING_AGE_MS);
		const snapshot = await db
			.collection('jobs')
			.where('active', '==', true)
			.where('firstSeenAt', '>', cutoff)
			.orderBy('firstSeenAt', 'desc')
			.limit(PREVIEW_LIMIT)
			.get();

		const previewJobs: JobListing[] = snapshot.docs.map((doc) => mapJobDoc(doc.id, doc.data()));
		return { previewJobs };
	} catch (err) {
		logger.error('landing.job_preview_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		return { previewJobs: [] as JobListing[] };
	}
};
