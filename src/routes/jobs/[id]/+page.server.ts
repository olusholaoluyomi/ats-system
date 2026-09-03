import { error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { logger } from '$lib/log';
import type { PageServerLoad } from './$types';
import { type JobListing, toIsoString } from '../shared';

export interface JobDetail extends JobListing {
	descriptionText: string;
	active: boolean;
}

export const load: PageServerLoad = async ({ params }) => {
	const { getAdminFirestore } = await import('$lib/server/firebase-admin');
	let db;
	try {
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
	if (!snap.exists || !data) {
		throw error(404, 'this job posting was not found');
	}

	// active:false is NOT a hard 404 - a dead link from an indexed search
	// result is worse UX than a stale-but-informative page. the template
	// shows a "may no longer be accepting applications" banner instead.
	const job: JobDetail = {
		id: snap.id,
		companyName: typeof data.companyName === 'string' ? data.companyName : '',
		title: typeof data.title === 'string' ? data.title : '',
		department: typeof data.department === 'string' ? data.department : null,
		locationRaw: typeof data.locationRaw === 'string' ? data.locationRaw : '',
		remote: data.remote === true,
		applyUrl: typeof data.applyUrl === 'string' ? data.applyUrl : '',
		whyThisCompany: typeof data.whyThisCompany === 'string' ? data.whyThisCompany : null,
		firstSeenAt: toIsoString(data.firstSeenAt),
		classification: data.classification ?? null,
		descriptionText: typeof data.descriptionText === 'string' ? data.descriptionText : '',
		active: data.active !== false
	};

	return { job };
};
