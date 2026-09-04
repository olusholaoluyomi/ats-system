import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { requireAdminToken } from '$lib/server/admin-auth';
import { logger } from '$lib/log';
import type { RequestHandler } from './$types';

// PATCH/DELETE only ever touch job_board_companies (admin-added entries) -
// seed-companies.ts and discovered-companies.json stay PR-reviewed files,
// not editable through this API, by construction (their ids aren't docs in
// this collection, so a PATCH/DELETE against one 404s rather than silently
// no-op-ing or reaching into a source this route doesn't own).
export const PATCH: RequestHandler = async ({ request, params }) => {
	requireAdminToken(request, privateEnv);

	const body = await request.json().catch(() => null);
	const changes: Record<string, unknown> = {};
	if (typeof body?.enabled === 'boolean') changes.enabled = body.enabled;
	if (typeof body?.whyThisCompany === 'string') changes.whyThisCompany = body.whyThisCompany.trim();
	if (Object.keys(changes).length === 0) {
		throw error(400, 'nothing to update - send enabled and/or whyThisCompany');
	}

	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) throw error(503, 'firebase admin not configured');

		const ref = db.doc(`job_board_companies/${params.id}`);
		const snap = await ref.get();
		if (!snap.exists) throw error(404, 'company not found in job_board_companies');

		await ref.set({ ...changes, updatedAt: new Date() }, { merge: true });
		logger.info('admin.company_updated', { id: params.id, changes: Object.keys(changes) });
		return json({ ok: true });
	} catch (err) {
		logger.error('admin.company_update_failed', {
			id: params.id,
			error: err instanceof Error ? err.message : String(err)
		});
		throw error(500, err instanceof Error ? err.message : 'failed to update company');
	}
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	requireAdminToken(request, privateEnv);

	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) throw error(503, 'firebase admin not configured');

		const ref = db.doc(`job_board_companies/${params.id}`);
		const snap = await ref.get();
		if (!snap.exists) throw error(404, 'company not found in job_board_companies');

		await ref.delete();
		logger.info('admin.company_deleted', { id: params.id });
		return json({ ok: true });
	} catch (err) {
		logger.error('admin.company_delete_failed', {
			id: params.id,
			error: err instanceof Error ? err.message : String(err)
		});
		throw error(500, err instanceof Error ? err.message : 'failed to delete company');
	}
};
