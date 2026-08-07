// one-off migration: seed the landing page's insights/global counters from
// historical data so they don't start at zero.
//
//   node scripts/backfill-insights.mjs <path-to-service-account.json>
//
// what gets seeded:
//   - resumesAnalyzed: the number of existing scan_logs documents. every saved
//     scan logs an entry there (sampled by PUBLIC_SCAN_LOG_SAMPLE_RATE,
//     default 1.0) and the collection is append-only, so it survives per-user
//     history pruning. counts all completed scans (LLM + rule-based fallback).
//   - userCount: the authoritative admin listUsers count (same number /api/stats
//     serves), so the firestore-side fallback counter starts from the real count
//     and future increment() calls stay in sync with listUsers. if Auth is
//     unavailable it falls back to the prior stats/public.userCount instead.
//
// the doc is written with absolute values (not firestore increment()) so this
// is a snapshot: re-running just re-reads the same history and overwrites with
// the same numbers rather than inflating them.
import { readFile } from 'node:fs/promises';
import { cert, getApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const [, , keyPath] = process.argv;
if (!keyPath) {
	console.error('usage: node scripts/backfill-insights.mjs <service-account.json>');
	process.exit(1);
}

const creds = JSON.parse(await readFile(keyPath, 'utf8'));
initializeApp({ credential: cert(creds), projectId: creds.project_id });

// the app's firestore is a custom-named 'default' database (the same one the
// client SDK addresses explicitly), so the admin handle must specify it too.
const db = getFirestore(getApp(), 'default');

const logsSnap = await db.collection('scan_logs').count().get();
const resumesAnalyzed = logsSnap.data().count;

async function countUsers() {
	let count = 0;
	let nextPageToken;
	do {
		const res = await getAuth().listUsers(1000, nextPageToken);
		count += res.users.length;
		nextPageToken = res.pageToken;
	} while (nextPageToken);
	return count;
}

let userCount = 0;
try {
	userCount = await countUsers();
} catch {
	const statsSnap = await db.doc('stats/public').get();
	const oldStats = statsSnap.data();
	userCount = typeof oldStats?.userCount === 'number' ? oldStats.userCount : 0;
}

await db.doc('insights/global').set({ userCount, resumesAnalyzed }, { merge: true });

console.log(`seeded insights/global: userCount=${userCount} resumesAnalyzed=${resumesAnalyzed}`);
