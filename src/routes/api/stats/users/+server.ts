import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { logger } from '$lib/log';
import { getAdminAuth } from '$lib/server/firebase-admin';
import { userCountCache } from '$lib/server/user-count';
import type { RequestHandler } from './$types';

// public read of the real firebase auth user count for the landing page's
// "Users Served" counter. the client SDK cannot enumerate accounts, so the
// count comes from the admin SDK and is cached server-side (listUsers is
// quota-bound and the landing page is high-traffic). when no service account
// is configured (self-host / dev / not yet set on the deploy), this returns
// 503 and the hero falls back to the firestore stats counter.
export const GET: RequestHandler = async () => {
	let auth;
	try {
		auth = getAdminAuth(privateEnv);
	} catch (err) {
		// init failure (bad/expired service account, malformed key). surface the
		// real reason instead of the framework's generic "Internal Error" so it
		// is diagnosable from the response; the hero degrades to the firestore
		// counter meanwhile.
		logger.error('stats.admin_init_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		throw error(500, err instanceof Error ? err.message : 'firebase admin init failed');
	}
	if (!auth) {
		throw error(503, 'firebase admin not configured');
	}
	try {
		const userCount = await userCountCache.get(auth);
		// a public stat: let the browser and Vercel's CDN hold it briefly on top
		// of the in-process cache. s-maxage matches the server cache TTL.
		return json(
			{ userCount },
			{
				headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' }
			}
		);
	} catch (err) {
		// failed auth walk (bad/expired service account, quota, network). surface
		// a 500 so the failure is loud; the hero degrades to the firestore counter.
		logger.error('stats.user_count_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		throw error(500, err instanceof Error ? err.message : 'failed to count users');
	}
};
