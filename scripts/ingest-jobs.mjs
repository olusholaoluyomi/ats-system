/**
 * job board ingestion: pulls open postings from every company in
 * SEED_COMPANIES (hand-curated) plus discovered-companies.json (found by
 * scripts/discover-companies.mjs, only ever added via a reviewed PR - see
 * .github/workflows/discover-companies.yml) via their public
 * Greenhouse/Lever/Ashby board, upserts postings into Firestore `jobs/`,
 * and LLM-classifies newly-inserted postings for Africa/remote/relocation/
 * salary signals. run on a schedule via .github/workflows/ingest-jobs.yml
 * (or `workflow_dispatch`/a direct local run with FIREBASE_SERVICE_ACCOUNT
 * and provider keys in the environment).
 *
 * one company's fetch/write/classify failure is caught and logged - it never
 * aborts the run. only exits non-zero if every enabled company failed (a
 * total outage), not for one flaky vendor.
 *
 * usage: node scripts/ingest-jobs.mjs   (needs node 22.18+ or 24 for type stripping)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cert, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { parseServiceAccount } from '../src/lib/server/service-account.ts';
import { PROVIDER_ENV_KEYS } from '../src/routes/api/analyze/providers.ts';
import { SEED_COMPANIES } from '../src/lib/server/job-board/seed-companies.ts';
import { fetchGreenhouseJobs } from '../src/lib/server/job-board/ats-clients/greenhouse.ts';
import { fetchLeverJobs } from '../src/lib/server/job-board/ats-clients/lever.ts';
import { fetchAshbyJobs } from '../src/lib/server/job-board/ats-clients/ashby.ts';
import {
	upsertCompanyPostings,
	sweepInactiveJobs
} from '../src/lib/server/job-board/dedupe-and-write.ts';
import { classifyPosting } from '../src/lib/server/job-board/classify.ts';

// discovered-companies.json only ever gains entries via a reviewed, merged
// PR (see discover-companies.mjs / .github/workflows/discover-companies.yml)
// - once merged, its entries are exactly as trusted as a hand-added
// seed-companies.ts entry, so they're combined here rather than needing a
// second manual copy-paste step.
const __dirname = dirname(fileURLToPath(import.meta.url));
const discoveredPath = join(__dirname, '../src/lib/server/job-board/discovered-companies.json');
let discoveredCompanies = [];
try {
	discoveredCompanies = JSON.parse(readFileSync(discoveredPath, 'utf8'));
} catch {
	// missing/malformed file just means no discovered companies yet
}
const ALL_COMPANIES = [...SEED_COMPANIES, ...discoveredCompanies];

const creds = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!creds) {
	console.error('FIREBASE_SERVICE_ACCOUNT is not set or malformed');
	process.exit(1);
}

initializeApp({ credential: cert(creds), projectId: creds.projectId });
// the app's firestore is a custom-named 'default' database (the same one the
// client SDK addresses explicitly), so the admin handle must specify it too.
const db = getFirestore(getApp(), 'default');

const keys = Object.fromEntries(PROVIDER_ENV_KEYS.map((k) => [k, process.env[k] ?? '']));
// job-board classification is Gemini/Groq only - Claude has no free tier, and this
// script can fire hundreds of classification calls in a single run, which would
// turn "the fallback leg is opt-in" into "the fallback leg gets hit hard on any
// Gemini/Groq hiccup during a bulk run." forced empty here regardless of whether
// CLAUDE_API_KEY happens to be set in the environment (e.g. reused from a local
// .env also used for `pnpm dev`), so this is a real gate, not just "don't set the
// GitHub secret" convention.
keys.CLAUDE_API_KEY = '';

const FETCHERS = {
	greenhouse: fetchGreenhouseJobs,
	lever: fetchLeverJobs,
	ashby: fetchAshbyJobs
};

// how stale (unseen) an active posting must be before the sweep marks it
// inactive: ~3 missed runs at the hourly cron interval, so a single flaky
// ingestion run never flickers a posting active/inactive. this catches a
// posting pulled down by its source EARLY (before the board's own 48h
// window would have aged it out anyway - see MAX_POSTING_AGE_MS in
// routes/jobs/+page.server.ts, which is the hard display-side cutoff).
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

const enabledCompanies = ALL_COMPANIES.filter((c) => c.enabled);
const touchedJobIds = new Set();
let newCount = 0;
let updatedCount = 0;
let classifiedCount = 0;
let failedCompanies = 0;

for (const company of enabledCompanies) {
	try {
		const fetcher = FETCHERS[company.atsType];
		const postings = await fetcher(company.boardToken);
		const results = await upsertCompanyPostings(db, company, postings);

		for (const r of results) touchedJobIds.add(r.jobId);
		const newResults = results.filter((r) => r.isNew);
		newCount += newResults.length;
		updatedCount += results.length - newResults.length;

		// classify new postings, plus any existing posting that was never
		// successfully classified (every LLM provider failed on some prior run) -
		// an already-classified posting keeps its existing tags even if its
		// description changed since (documented v1 cost-control tradeoff, see the
		// job-board plan).
		const toClassify = results.filter((r) => r.needsClassification);
		for (const r of toClassify) {
			const posting = postings.find((p) => `${company.atsType}:${p.externalId}` === r.jobId);
			if (!posting) continue;
			try {
				const classification = await classifyPosting(posting, keys);
				if (classification) {
					await db
						.doc(`jobs/${r.jobId}`)
						.set({ classification, classifiedAt: new Date() }, { merge: true });
					classifiedCount++;
				}
			} catch (err) {
				console.error(`  classify failed for ${r.jobId}: ${err.message}`);
			}
		}

		console.log(
			`${company.name} (${company.atsType}): fetched ${postings.length}, new ${newResults.length}, updated ${results.length - newResults.length}`
		);
	} catch (err) {
		failedCompanies++;
		console.error(`${company.name} (${company.atsType}) FAILED: ${err.message}`);
	}
}

const sweptCount = await sweepInactiveJobs(db, touchedJobIds, STALE_AFTER_MS);

console.log(
	`\ndone: ${newCount} new, ${updatedCount} updated, ${classifiedCount} classified, ${sweptCount} swept inactive, ${failedCompanies}/${enabledCompanies.length} companies failed`
);

if (enabledCompanies.length > 0 && failedCompanies === enabledCompanies.length) {
	console.error('every company failed - treating as a total outage');
	process.exit(1);
}
