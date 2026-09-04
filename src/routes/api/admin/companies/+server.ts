import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { requireAdminToken } from '$lib/server/admin-auth';
import { logger } from '$lib/log';
import { SEED_COMPANIES } from '$lib/server/job-board/seed-companies';
import discoveredCompanies from '$lib/server/job-board/discovered-companies.json';
import { fetchGreenhouseJobs } from '$lib/server/job-board/ats-clients/greenhouse';
import { fetchLeverJobs } from '$lib/server/job-board/ats-clients/lever';
import { fetchAshbyJobs } from '$lib/server/job-board/ats-clients/ashby';
import type { RequestHandler } from './$types';

// admin-only company-list surface, gated by ADMIN_TOKEN (see
// $lib/server/admin-auth). GET returns a merged view across all three
// sources the ingestion pipeline actually reads from (seed-companies.ts,
// discovered-companies.json, and this route's own job_board_companies
// collection) so an admin sees the whole picture in one place, not just the
// slice they can edit. POST adds ONLY to job_board_companies - seed/
// discovered stay code/PR-reviewed as before, this is strictly additive.
const ATS_FETCHERS = {
	greenhouse: fetchGreenhouseJobs,
	lever: fetchLeverJobs,
	ashby: fetchAshbyJobs
} as const;

interface AdminCompany {
	id: string;
	slug: string;
	name: string;
	atsType: 'greenhouse' | 'lever' | 'ashby';
	boardToken: string;
	whyThisCompany: string | null;
	enabled: boolean;
	source: 'seed' | 'discovered' | 'admin';
}

export const GET: RequestHandler = async ({ request }) => {
	requireAdminToken(request, privateEnv);

	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);

		const seedRows: AdminCompany[] = SEED_COMPANIES.map((c) => ({
			id: c.slug,
			slug: c.slug,
			name: c.name,
			atsType: c.atsType,
			boardToken: c.boardToken,
			whyThisCompany: c.whyThisCompany ?? null,
			enabled: c.enabled,
			source: 'seed'
		}));

		const discoveredRows: AdminCompany[] = (
			discoveredCompanies as Array<{
				slug: string;
				name: string;
				atsType: 'greenhouse' | 'lever' | 'ashby';
				boardToken: string;
				whyThisCompany?: string;
				enabled: boolean;
			}>
		).map((c) => ({
			id: c.slug,
			slug: c.slug,
			name: c.name,
			atsType: c.atsType,
			boardToken: c.boardToken,
			whyThisCompany: c.whyThisCompany ?? null,
			enabled: c.enabled,
			source: 'discovered'
		}));

		let adminRows: AdminCompany[] = [];
		if (db) {
			const snapshot = await db.collection('job_board_companies').get();
			adminRows = snapshot.docs.map((doc) => {
				const data = doc.data();
				return {
					id: doc.id,
					slug: typeof data.slug === 'string' ? data.slug : doc.id,
					name: typeof data.name === 'string' ? data.name : '',
					atsType: data.atsType,
					boardToken: typeof data.boardToken === 'string' ? data.boardToken : '',
					whyThisCompany: typeof data.whyThisCompany === 'string' ? data.whyThisCompany : null,
					enabled: data.enabled !== false,
					source: 'admin'
				};
			});
		}

		return json(
			{ companies: [...seedRows, ...discoveredRows, ...adminRows] },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (err) {
		logger.error('admin.companies_list_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		throw error(500, err instanceof Error ? err.message : 'failed to list companies');
	}
};

export const POST: RequestHandler = async ({ request }) => {
	requireAdminToken(request, privateEnv);

	const body = await request.json().catch(() => null);
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	const boardToken = typeof body?.boardToken === 'string' ? body.boardToken.trim() : '';
	const atsType = body?.atsType;
	const whyThisCompany =
		typeof body?.whyThisCompany === 'string' && body.whyThisCompany.trim()
			? body.whyThisCompany.trim()
			: null;

	if (!name || !boardToken || !(atsType in ATS_FETCHERS)) {
		throw error(400, 'name, boardToken, and a valid atsType (greenhouse/lever/ashby) are required');
	}

	// never trust an admin-typed slug blindly either - verify it actually
	// resolves against the real ATS API before writing it, exactly like
	// discover-companies.mjs does for its own candidates.
	try {
		await ATS_FETCHERS[atsType as keyof typeof ATS_FETCHERS](boardToken);
	} catch {
		throw error(422, `${boardToken} does not resolve on ${atsType} - check the board token`);
	}

	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) throw error(503, 'firebase admin not configured');

		const slug = boardToken.toLowerCase();
		await db.doc(`job_board_companies/${slug}`).set({
			slug,
			name,
			atsType,
			boardToken,
			whyThisCompany,
			enabled: true,
			createdAt: new Date()
		});

		logger.info('admin.company_added', { slug, atsType });
		return json({ ok: true, id: slug });
	} catch (err) {
		logger.error('admin.company_add_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		throw error(500, err instanceof Error ? err.message : 'failed to add company');
	}
};
