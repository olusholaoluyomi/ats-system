import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { logger } from '$lib/log';
import { resolveAuthMode } from '$lib/server/auth/config';

export const POST: RequestHandler = async ({ request }) => {
	if (resolveAuthMode({ ...privateEnv, ...publicEnv }) !== 'firebase') {
		return json({ error: 'account deletion is only available in firebase mode' }, { status: 400 });
	}

	const { verifyFirebaseIdToken } = await import('$lib/server/auth/token');
	const identity = await verifyFirebaseIdToken(privateEnv, request.headers.get('authorization'));
	if (!identity) {
		return json({ error: 'authentication required' }, { status: 401 });
	}

	try {
		const { getAdminAuth, getAdminFirestore } = await import('$lib/server/firebase-admin');
		const auth = getAdminAuth(privateEnv);
		const db = await getAdminFirestore(privateEnv);
		if (!auth || !db) {
			return json({ error: 'admin services not configured' }, { status: 503 });
		}

		// delete user-scoped docs but keep payments/* ledger for audit
		const billingRef = db.doc(`users/${identity.uid}/billing/state`);
		const scansRef = db.doc(`users/${identity.uid}/scans`);
		await db.runTransaction(async (tx) => {
			// delete the small docs under the user's space
			tx.set(billingRef, { deleted: true });
			tx.set(scansRef, { deleted: true });
		});

		// delete the auth user
		await auth.deleteUser(identity.uid);
		logger.info('account.deleted', { uid: identity.uid });
		return json({ ok: true });
	} catch (err) {
		logger.error('account.delete_failed', { uid: identity.uid, error: err instanceof Error ? err.message : String(err) });
		return json({ error: 'failed to delete account' }, { status: 500 });
	}
};
