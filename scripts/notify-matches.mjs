/**
 * in-app match notifications: run as a step in .github/workflows/ingest-jobs.yml
 * right after ingest-jobs.mjs. finds postings first seen within the lookback
 * window (see LOOKBACK_MS below), then for every user with notifyOnMatch=true
 * on their profile, checks each new posting against that user's own
 * notifyKeywords/notifyRemoteOnly using the SAME matchesFilters() the job
 * board itself uses (src/routes/jobs/shared.ts) - one matching
 * implementation, not two, so "would this show up under my filters" and
 * "would I get notified about it" never drift apart.
 *
 * decoupled from ingest-jobs.mjs on purpose: rather than passing state
 * between the two scripts (fragile across a run that can take 40+ minutes
 * for a large company set), this queries Firestore directly for jobs whose
 * firstSeenAt falls in the lookback window - firstSeenAt is set once, at
 * creation, and never touched again (see dedupe-and-write.ts), so it's a
 * reliable "created since I last ran" signal on its own.
 *
 * email delivery is NOT implemented - there is no transactional email
 * provider configured for this app (no account, no API key). the obvious
 * next step once one exists is a sendEmail(user, notifications) call right
 * after the Firestore writes below; until then, notifications only appear
 * in-app (see src/lib/stores/notifications.svelte.ts).
 *
 * usage: node scripts/notify-matches.mjs   (needs FIREBASE_SERVICE_ACCOUNT
 * in the environment, same as ingest-jobs.mjs)
 */
import { cert, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { parseServiceAccount } from '../src/lib/server/service-account.ts';
import { mapJobDoc, matchesFilters } from '../src/routes/jobs/shared.ts';

// every-8-hours cron (see ingest-jobs.yml) plus generous slack for a slow
// run - wide enough that a run which takes longer than usual still catches
// every posting first seen since the previous run, without needing to share
// exact timing between the two scripts.
const LOOKBACK_MS = 10 * 60 * 60 * 1000;

const creds = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!creds) {
	console.error('FIREBASE_SERVICE_ACCOUNT is not set or malformed');
	process.exit(1);
}

initializeApp({ credential: cert(creds), projectId: creds.projectId });
const db = getFirestore(getApp(), 'default');

const cutoff = Timestamp.fromMillis(Date.now() - LOOKBACK_MS);

const newJobsSnap = await db.collection('jobs').where('firstSeenAt', '>=', cutoff).get();
if (newJobsSnap.empty) {
	console.log('no newly-seen postings in the lookback window - nothing to notify');
	process.exit(0);
}
const newJobs = newJobsSnap.docs.map((doc) => mapJobDoc(doc.id, doc.data()));
console.log(`${newJobs.length} posting(s) first seen in the last ${LOOKBACK_MS / 60000} minutes`);

// collection-group query across every users/{uid}/profile/settings doc -
// requires the COLLECTION_GROUP field-override index on notifyOnMatch (see
// firestore.indexes.json).
const profilesSnap = await db.collectionGroup('profile').where('notifyOnMatch', '==', true).get();

let notifiedUsers = 0;
let notificationsWritten = 0;

for (const profileDoc of profilesSnap.docs) {
	const uid = profileDoc.ref.parent.parent?.id;
	if (!uid) continue;

	const profile = profileDoc.data();
	const filters = {
		remote: Boolean(profile.notifyRemoteOnly),
		query:
			typeof profile.notifyKeywords === 'string' && profile.notifyKeywords.trim()
				? profile.notifyKeywords.trim()
				: null,
		experienceMin: null,
		experienceMax: null
	};

	const matches = newJobs.filter((job) => matchesFilters(job, filters));
	if (matches.length === 0) continue;

	notifiedUsers++;
	for (const job of matches) {
		// deterministic doc ID (jobId) so a user never gets a duplicate
		// notification for the same posting if the lookback window overlaps
		// two runs - and .create() (not .set()) so a run that re-sees the
		// same job never resets an already-read notification back to unread.
		const ref = db.doc(`users/${uid}/notifications/${job.id}`);
		try {
			await ref.create({
				jobId: job.id,
				title: job.title,
				companyName: job.companyName,
				createdAt: new Date(),
				read: false
			});
			notificationsWritten++;
		} catch (err) {
			// ALREADY_EXISTS is expected on lookback-window overlap; anything
			// else is worth surfacing but shouldn't abort the rest of the run.
			if (err.code !== 6) {
				console.error(`failed to write notification ${job.id} for user ${uid}: ${err.message}`);
			}
		}
	}
}

console.log(
	`done: ${notificationsWritten} notification(s) written for ${notifiedUsers} matching user(s)`
);
