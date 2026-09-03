import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { logger } from '$lib/log';
import { resolveAuthMode } from '$lib/server/auth/config';
import { checkPaymentRateLimit } from '$lib/server/payment-rate-limit';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (resolveAuthMode({ ...privateEnv, ...publicEnv }) !== 'firebase') {
		return json({ error: 'account deletion is only available in firebase mode' }, { status: 400 });
	}

	const rateLimit = await checkPaymentRateLimit(privateEnv, 'account-delete', getClientAddress());
	if (!rateLimit.allowed) {
		return json(
			{ error: 'too many requests', retryAfter: rateLimit.retryAfterSec },
			{ status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSec) } }
		);
	}

	const { requireFirebaseIdentity } = await import('$lib/server/auth/token');
	const authResult = await requireFirebaseIdentity(privateEnv, request.headers.get('authorization'));
	if ('response' in authResult) return authResult.response;
	const identity = authResult.identity;

	try {
		const { getAdminAuth, getAdminFirestore } = await import('$lib/server/firebase-admin');
		const auth = getAdminAuth(privateEnv);
		const db = await getAdminFirestore(privateEnv);
		if (!auth || !db) {
			return json({ error: 'admin services not configured' }, { status: 503 });
		}

		// delete user-scoped docs but keep payments/* ledger for audit.
		// `users/{uid}/scans` is a collection (submitted resumes/scores live at
		// users/{uid}/scans/{scanId}), not a document - db.doc() on an odd
		// number of path segments throws synchronously, and even a valid doc
		// ref wouldn't cascade-delete the scan documents underneath it.
		// recursiveDelete is a bulk operation and can't run inside
		// runTransaction, so it's a separate step from the billing tombstone.
		const billingRef = db.doc(`users/${identity.uid}/billing/state`);
		const scansRef = db.collection(`users/${identity.uid}/scans`);
		await db.recursiveDelete(scansRef);
		await db.runTransaction(async (tx) => {
			tx.set(billingRef, { deleted: true });
		});

		// delete the auth user
		await auth.deleteUser(identity.uid);
		logger.info('account.deleted', { uid: identity.uid });
		return json({ ok: true });
	} catch (err) {
		logger.error('account.delete_failed', {
			uid: identity.uid,
			error: err instanceof Error ? err.message : String(err)
		});
		return json({ error: 'failed to delete account' }, { status: 500 });
	}
};
