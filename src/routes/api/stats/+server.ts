import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { logger } from '$lib/log';
import type { Auth } from 'firebase-admin/auth';
import type { RequestHandler } from './$types';

// public read of the landing page's two aggregate stats: the real firebase
// auth user count ("Users Served") and the number of resumes analyzed.
// the client SDK cannot enumerate accounts, so userCount comes from the admin
// SDK (cached server-side; listUsers is quota-bound and the landing page is
// high-traffic). resumesAnalyzed is a client-incremented counter in the
// insights/global firestore doc, read here through the admin SDK so the page
// gets both numbers from one CDN-cached request. when no service account is
// configured (self-host / dev / not yet set on the deploy), this returns 503
// and the hero falls back to the live firestore stats counter.
export const GET: RequestHandler = async () => {
	// firebase-admin is imported dynamically on purpose: the admin SDK pulls in
	// heavy deps (firestore, grpc, etc.) that occasionally fail to LOAD on the
	// serverless runtime. a static import would throw during module evaluation,
	// before any try/catch here runs, and surface as the framework's generic
	// "Internal Error". dynamic import keeps every failure inside the catch so
	// the real message is returned and logged.
	let auth: Auth | null;
	try {
		const { getAdminAuth } = await import('$lib/server/firebase-admin');
		auth = getAdminAuth(privateEnv);
	} catch (err) {
		// import or init failure (bad/expired service account, malformed key,
		// missing dependency in the bundled function). surface the real reason
		// instead of "Internal Error" so it is diagnosable from the response;
		// the hero degrades to the firestore counter meanwhile.
		logger.error('stats.admin_init_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		throw error(500, err instanceof Error ? err.message : 'firebase admin init failed');
	}
	if (!auth) {
		throw error(503, 'firebase admin not configured');
	}
	try {
		const [{ userCountCache }, { getAdminFirestore }] = await Promise.all([
			import('$lib/server/user-count'),
			import('$lib/server/firebase-admin')
		]);
		const userCount = await userCountCache.get(auth);
		const db = await getAdminFirestore(privateEnv);
		const snapshot = db ? await db.doc('insights/global').get() : null;
		const data = snapshot?.data();
		const resumesAnalyzed =
			data && typeof data.resumesAnalyzed === 'number' ? data.resumesAnalyzed : 0;
		// public stats: let the browser and Vercel's CDN hold them briefly on top
		// of the in-process cache. s-maxage matches the server cache TTL.
		return json(
			{ userCount, resumesAnalyzed },
			{
				headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' }
			}
		);
	} catch (err) {
		// failed auth walk or insights read (bad/expired service account, quota,
		// network). surface a 500 so the failure is loud; the hero degrades to
		// the firestore counter.
		logger.error('stats.read_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		throw error(500, err instanceof Error ? err.message : 'failed to read stats');
	}
};
