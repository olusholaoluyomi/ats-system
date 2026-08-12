import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { logger } from '$lib/log';
import { resolveAuthMode } from '$lib/server/auth/config';

export const GET: RequestHandler = async ({ request }) => {
	if (resolveAuthMode({ ...privateEnv, ...publicEnv }) !== 'firebase') {
		return json({ error: 'payments are only available in firebase mode' }, { status: 400 });
	}

	const { verifyFirebaseIdToken } = await import('$lib/server/auth/token');
	const identity = await verifyFirebaseIdToken(privateEnv, request.headers.get('authorization'));
	if (!identity) {
		return json({ error: 'authentication required' }, { status: 401 });
	}

	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) {
			return json({ error: 'billing is not configured on this deploy' }, { status: 503 });
		}

		const q = db
			.collection('payments')
			.where('uid', '==', identity.uid)
			.orderBy('createdAt', 'desc')
			.limit(200);
		const snap = await q.get();

		const payments = snap.docs.map((d) => {
			const data = d.data() as Record<string, unknown>;
			const created = data.createdAt;
			let createdIso = null;
			if (created && typeof (created as { toDate?: () => Date }).toDate === 'function') {
				createdIso = (created as { toDate: () => Date }).toDate().toISOString();
			} else if (created instanceof Date) {
				createdIso = created.toISOString();
			} else if (typeof created === 'string') {
				createdIso = created;
			}

			return {
				reference: typeof data.reference === 'string' ? data.reference : d.id,
				amountMinor: typeof data.amountMinor === 'number' ? data.amountMinor : null,
				currency: typeof data.currency === 'string' ? data.currency : null,
				status: typeof data.status === 'string' ? data.status : null,
				createdAt: createdIso,
				// scansAllowed is the configured scans per successful payment when it settled
				scansAllowed: typeof data.scansAllowed === 'number' ? data.scansAllowed : null
			};
		});

		return json({ ok: true, payments });
	} catch (err) {
		logger.error('payment.history_failed', {
			uid: identity?.uid ?? 'unknown',
			error: err instanceof Error ? err.message : String(err)
		});
		return json({ error: 'failed to load payment history' }, { status: 500 });
	}
};
