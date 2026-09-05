/**
 * job board ingestion: pulls open postings from every company across THREE
 * sources - SEED_COMPANIES (hand-curated, PR-reviewed), discovered-
 * companies.json (found by scripts/discover-companies.mjs, also PR-
 * reviewed - see .github/workflows/discover-companies.yml), and the
 * job_board_companies Firestore collection (added via the token-gated
 * /api/admin/companies routes, self-serve rather than PR-reviewed - see
 * that route's own comment for why this is a deliberate, contained
 * exception to "curated data is never client/admin-writable" elsewhere in
 * this app) - via their public Greenhouse/Lever/Ashby board, and upserts
 * postings into Firestore `jobs/`. run on a schedule via
 * .github/workflows/ingest-jobs.yml (or `workflow_dispatch`/a direct local
 * run with FIREBASE_SERVICE_ACCOUNT in the environment).
 *
 * no LLM classification step - postings are shown as-is, filtered/searched
 * by the board's own remote flag (native to each ATS's API, not inferred)
 * and a real Firestore keyword query over title/company/department (see
 * jobs/+page.server.ts). an earlier version LLM-tagged every posting for
 * relocation/Africa-friendliness/experience level, but that meant hundreds
 * of classification calls per run against free-tier providers that
 * couldn't reliably keep up - not worth the token cost or the
 * unclassified backlog it left behind.
 *
 * QUOTA BUDGET (Firestore free tier: 50k reads / 20k writes / 20k deletes
 * per day): this script is deliberately shaped around that ceiling, and got
 * this wrong once already (2026-09-05) - worth being precise this time.
 *  - Firestore bills ONE READ PER DOCUMENT RETURNED, not one read per query
 *    call. dedupe-and-write.ts's upsertCompanyPostings issues exactly one
 *    QUERY per company (that company's existing docs), but that query still
 *    returns up to MAX_POSTINGS_PER_COMPANY documents - the read cost is
 *    `companies × cap`, not `companies`. an earlier version of this comment
 *    said "one read per company" and treated the query-count reduction as
 *    if it were a document-count reduction; it wasn't, and a single run
 *    exhausted the entire daily read quota in ~11 minutes as a result. the
 *    real reduction that DID land: eliminating the old separate global
 *    sweep query that re-read every active job across every company, every
 *    run, on top of the per-posting reads.
 *  - it writes only postings that are new/changed/reactivated/deactivated -
 *    an unchanged posting costs zero writes on re-ingestion. this part was
 *    correct and is the main thing keeping writes (not reads) under budget.
 *  - MAX_POSTINGS_PER_COMPANY below caps how many of one company's postings
 *    get ingested AND how many of its existing docs get read back each
 *    run - both scale directly with this number × company count, so it's
 *    the single biggest lever on the read budget, not just a content-
 *    diversity knob.
 *  - the ingestion cron (.github/workflows/ingest-jobs.yml) runs every 8
 *    hours (3x/day), not every 4 - see that file's comment for the budget
 *    math with the current cap.
 *
 * one company's fetch/write failure is caught and logged - it never aborts
 * the run. only exits non-zero if every enabled company failed (a total
 * outage), not for one flaky vendor.
 *
 * usage: node scripts/ingest-jobs.mjs   (needs node 22.18+ or 24 for type stripping)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cert, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { parseServiceAccount } from '../src/lib/server/service-account.ts';
import { SEED_COMPANIES } from '../src/lib/server/job-board/seed-companies.ts';
import { fetchGreenhouseJobs } from '../src/lib/server/job-board/ats-clients/greenhouse.ts';
import { fetchLeverJobs } from '../src/lib/server/job-board/ats-clients/lever.ts';
import { fetchAshbyJobs } from '../src/lib/server/job-board/ats-clients/ashby.ts';
import {
	upsertCompanyPostings,
	deleteStalePostings
} from '../src/lib/server/job-board/dedupe-and-write.ts';

// one company (Databricks, OpenAI, Stripe, etc. have all shown 500-900+
// live postings at once) can otherwise dwarf every other company on the
// board - this keeps the board diverse across companies. but it's also,
// more importantly now, the main lever on Firestore read cost: each run
// reads back up to this many existing docs PER COMPANY (see the file
// header's QUOTA BUDGET note) - at ~250+ companies, 40 was ~10,000 reads
// per run, enough to exhaust the entire 50k/day quota in a single run.
// 15 keeps that to ~3,750/run, leaving real headroom for page-view reads
// even at 3 runs/day. passed through to upsertCompanyPostings as
// options.maxPostings rather than slicing the fetched list here - that
// function needs the FULL fetched list to correctly tell "genuinely gone
// from the source" apart from "just over our own cap" when deciding what
// to deactivate (see its own comment on UpsertOptions.maxPostings; an
// earlier version sliced the list here, which silently deactivated a
// capped company's overflow postings on every run instead of leaving them
// alone).
const MAX_POSTINGS_PER_COMPANY = 15;

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

const creds = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!creds) {
	console.error('FIREBASE_SERVICE_ACCOUNT is not set or malformed');
	process.exit(1);
}

initializeApp({ credential: cert(creds), projectId: creds.projectId });
// the app's firestore is a custom-named 'default' database (the same one the
// client SDK addresses explicitly), so the admin handle must specify it too.
const db = getFirestore(getApp(), 'default');

// third source: admin-added companies, added via /api/admin/companies
// (self-serve, not PR-reviewed) - fetched here since it needs the admin
// Firestore handle that just got initialized above. a failure here is
// non-fatal (falls back to seed+discovered only) since this collection may
// simply be empty on a fresh deploy.
let adminCompanies = [];
try {
	const snapshot = await db.collection('job_board_companies').get();
	adminCompanies = snapshot.docs.map((doc) => doc.data()).filter((c) => c.enabled !== false);
} catch (err) {
	console.error(`failed to read job_board_companies: ${err.message}`);
}

const ALL_COMPANIES = [...SEED_COMPANIES, ...discoveredCompanies, ...adminCompanies];

const FETCHERS = {
	greenhouse: fetchGreenhouseJobs,
	lever: fetchLeverJobs,
	ashby: fetchAshbyJobs
};

const enabledCompanies = ALL_COMPANIES.filter((c) => c.enabled);
let newCount = 0;
let changedCount = 0;
let skippedCount = 0;
let failedCompanies = 0;

for (const company of enabledCompanies) {
	try {
		const fetcher = FETCHERS[company.atsType];
		const postings = await fetcher(company.boardToken);
		const results = await upsertCompanyPostings(db, company, postings, {
			maxPostings: MAX_POSTINGS_PER_COMPANY
		});

		const newResults = results.filter((r) => r.isNew);
		const changedResults = results.filter((r) => !r.isNew && r.written);
		const skippedResults = results.filter((r) => !r.written);
		newCount += newResults.length;
		changedCount += changedResults.length;
		skippedCount += skippedResults.length;

		console.log(
			`${company.name} (${company.atsType}): fetched ${postings.length}, new ${newResults.length}, changed ${changedResults.length}, unchanged (no write) ${skippedResults.length}`
		);
	} catch (err) {
		failedCompanies++;
		console.error(`${company.name} (${company.atsType}) FAILED: ${err.message}`);
	}
}

// storage cleanup: hard-delete postings that have been inactive for a while
// (well past the 48h display window) - see deleteStalePostings's own
// comment. bounded per run, cheap against the delete quota either way.
const STALE_DELETE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const deletedCount = await deleteStalePostings(db, STALE_DELETE_AFTER_MS);

console.log(
	`\ndone: ${newCount} new, ${changedCount} changed, ${skippedCount} unchanged (no write), ${deletedCount} stale postings deleted, ${failedCompanies}/${enabledCompanies.length} companies failed`
);

if (enabledCompanies.length > 0 && failedCompanies === enabledCompanies.length) {
	console.error('every company failed - treating as a total outage');
	process.exit(1);
}
