// minimal public read of one job posting, used by the scanner's "Check my CV
// Score" hand-off (?jobId=... -> this endpoint -> scoresStore.setJobDescription).
// deliberately returns only the fields the scanner needs, not the full
// jobs/{id} doc (source/ATS metadata stays server-side).
import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { logger } from '$lib/log';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	let db;
	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		db = await getAdminFirestore(privateEnv);
	} catch (err) {
		logger.error('jobs.detail_admin_init_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		throw error(500, 'failed to load job');
	}
	if (!db) throw error(503, 'job board is not configured on this deploy');

	const snap = await db.doc(`jobs/${params.id}`).get();
	const data = snap.data();
	// no active check: a posting that's since gone inactive/expired is still
	// a valid thing to score your resume against (the detail page shows it
	// with a "may no longer be accepting applications" banner rather than a
	// hard 404, for the same reason - see jobs/[id]/+page.server.ts).
	if (!snap.exists || !data) {
		throw error(404, 'job not found');
	}

	return json(
		{
			title: typeof data.title === 'string' ? data.title : '',
			companyName: typeof data.companyName === 'string' ? data.companyName : '',
			descriptionText: typeof data.descriptionText === 'string' ? data.descriptionText : ''
		},
		{ headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } }
	);
};
