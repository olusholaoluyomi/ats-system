import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { requireAdminToken } from '$lib/server/admin-auth';
import { logger } from '$lib/log';
import type { RequestHandler } from './$types';

// admin-only read of apply-click counts, sorted highest-first. gated by
// ADMIN_TOKEN (see $lib/server/admin-auth), same as rate-limit-stats.
// admin SDK imported dynamically so an init failure surfaces as a real
// message instead of the framework's generic error - see api/stats's own
// comment for why this matters on the serverless runtime.
export const GET: RequestHandler = async ({ request }) => {
	requireAdminToken(request, privateEnv);

	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) throw error(503, 'firebase admin not configured');

		const snapshot = await db.collection('job_analytics').get();
		const rows = snapshot.docs
			.map((doc) => ({
				jobId: doc.id,
				applyClicks: typeof doc.data().applyClicks === 'number' ? doc.data().applyClicks : 0
			}))
			.sort((a, b) => b.applyClicks - a.applyClicks);

		return json({ rows }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		logger.error('admin.job_analytics_read_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		throw error(500, err instanceof Error ? err.message : 'failed to read job analytics');
	}
};
