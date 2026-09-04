/**
 * daily company discovery from TWO independent candidate sources, so the
 * board isn't Y-Combinator-only (an earlier version only pulled from YC,
 * which skews small/early-stage/engineering-heavy and under-represents
 * non-SWE roles like product/ops/network-infra):
 *
 *  1. Y Combinator's public company dataset (https://github.com/yc-oss/api -
 *     not an official YC API, but a well-maintained static mirror; verified
 *     live before building this).
 *  2. KNOWN_COMPANIES_POOL (known-companies-pool.ts) - a hand-compiled list
 *     of established, non-YC companies across industries, picked for role
 *     diversity (several specifically for network/infra-heavy teams).
 *
 * both sources go through the identical live-verification step: try the
 * candidate's slug as a board token against Greenhouse/Lever/Ashby, keep
 * only what actually resolves. neither source touches seed-companies.ts
 * (the hand-curated list) directly, and neither auto-enables anything live -
 * see .github/workflows/discover-companies.yml, which opens a PR for a
 * human to review before a discovered company's jobs can appear on the
 * board.
 *
 * candidate selection rotates through each pool by day-of-year rather than
 * relying solely on persisted state, so full pool coverage doesn't depend
 * on every run's state-file write succeeding (see the best-effort
 * direct-push in the workflow, which can be blocked by branch protection
 * and is allowed to fail without breaking the run). discovery-state.json is
 * a skip-list optimization on top of that rotation, not the only thing
 * standing between "checked" and "not checked" - shared across both pools
 * since board tokens are globally unique regardless of source.
 *
 * usage: node scripts/discover-companies.mjs   (needs node 22.18+ or 24 for type stripping)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEED_COMPANIES } from '../src/lib/server/job-board/seed-companies.ts';
import { KNOWN_COMPANIES_POOL } from '../src/lib/server/job-board/known-companies-pool.ts';
import { fetchGreenhouseJobs } from '../src/lib/server/job-board/ats-clients/greenhouse.ts';
import { fetchLeverJobs } from '../src/lib/server/job-board/ats-clients/lever.ts';
import { fetchAshbyJobs } from '../src/lib/server/job-board/ats-clients/ashby.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOB_BOARD_DIR = join(__dirname, '../src/lib/server/job-board');
const DISCOVERED_PATH = join(JOB_BOARD_DIR, 'discovered-companies.json');
const STATE_PATH = join(JOB_BOARD_DIR, 'discovery-state.json');

const YC_COMPANIES_URL = 'https://yc-oss.github.io/api/companies/all.json';
// polite batch size per source: 150 YC candidates + up to the full ~110-entry
// known-companies pool (small enough to not need its own rotation window),
// each x up to 3 ATS checks = a few hundred requests to free, unauthenticated
// public APIs per run, once daily.
const DAILY_BATCH_SIZE = 150;
const KNOWN_POOL_BATCH_SIZE = 60;

function readJson(path, fallback) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return fallback;
	}
}

function dayOfYear() {
	const now = new Date();
	const start = Date.UTC(now.getUTCFullYear(), 0, 0);
	return Math.floor((Date.now() - start) / 86_400_000);
}

const discovered = readJson(DISCOVERED_PATH, []);
const state = readJson(STATE_PATH, { triedSlugs: [] });
const triedSlugs = new Set(state.triedSlugs ?? []);

const knownBoardTokens = new Set([
	...SEED_COMPANIES.map((c) => c.boardToken.toLowerCase()),
	...discovered.map((c) => c.boardToken.toLowerCase())
]);

const response = await fetch(YC_COMPANIES_URL);
if (!response.ok) {
	console.error(`failed to fetch YC company list: HTTP ${response.status}`);
	process.exit(1);
}
const ycCompanies = await response.json();

// eligible YC pool: active, currently hiring, not already known (seeded or
// previously discovered) - triedSlugs is deliberately NOT excluded from
// either pool here, only used to skip individual entries within the
// rotated windows below, so a slug that failed once can still resurface
// (e.g. a company that adds a board later). normalized to {slug, name,
// whyThisCompany} so both sources share one testing loop below.
const ycPool = ycCompanies
	.filter(
		(c) =>
			c.status === 'Active' &&
			c.isHiring === true &&
			c.slug &&
			!knownBoardTokens.has(c.slug.toLowerCase())
	)
	.map((c) => ({
		slug: c.slug,
		name: c.name,
		whyThisCompany: c.one_liner
			? `YC company (${c.batch ?? 'alum'}): ${c.one_liner}`
			: `Y Combinator company (${c.batch ?? 'alum'}).`
	}));

// known-companies pool: established, non-YC companies - see
// known-companies-pool.ts's own comment for why this exists (the board was
// skewing YC-only with only one discovery source).
const knownPool = KNOWN_COMPANIES_POOL.filter(
	(c) => !knownBoardTokens.has(c.slug.toLowerCase())
).map((c) => ({
	slug: c.slug,
	name: c.name,
	whyThisCompany: 'Established company, discovered via automated board check.'
}));

// rotate each pool independently by day-of-year so full coverage of either
// set doesn't depend on state persisting between runs.
function rotateWindow(pool, batchSize) {
	if (pool.length === 0) return [];
	const start = (dayOfYear() * batchSize) % pool.length;
	return [...pool.slice(start), ...pool.slice(0, start)].slice(0, batchSize);
}

const ycWindow = rotateWindow(ycPool, DAILY_BATCH_SIZE).filter((c) => !triedSlugs.has(c.slug));
const knownWindow = rotateWindow(knownPool, KNOWN_POOL_BATCH_SIZE).filter(
	(c) => !triedSlugs.has(c.slug)
);
const candidates = [...ycWindow, ...knownWindow];

if (candidates.length === 0) {
	console.log('no eligible candidates from either source this window (all known or tried)');
	process.exit(0);
}

console.log(
	`checking ${candidates.length} candidates (${ycWindow.length} from YC pool of ${ycPool.length}, ${knownWindow.length} from known-companies pool of ${knownPool.length}, ${triedSlugs.size} previously tried)`
);

const ATS_CHECKS = [
	{ atsType: 'greenhouse', fetcher: fetchGreenhouseJobs },
	{ atsType: 'lever', fetcher: fetchLeverJobs },
	{ atsType: 'ashby', fetcher: fetchAshbyJobs }
];

const newlyFound = [];

for (const company of candidates) {
	triedSlugs.add(company.slug);
	for (const { atsType, fetcher } of ATS_CHECKS) {
		try {
			const postings = await fetcher(company.slug);
			newlyFound.push({
				slug: company.slug,
				name: company.name,
				atsType,
				boardToken: company.slug,
				whyThisCompany: company.whyThisCompany,
				enabled: true
			});
			console.log(`  found: ${company.name} on ${atsType} (${postings.length} current postings)`);
			break; // stop at the first ATS that resolves for this company
		} catch {
			// not on this ATS (or a transient failure) - try the next one
		}
	}
}

// best-effort: try to persist state directly so the next run's skip-list is
// up to date. non-fatal if this fails (e.g. branch protection blocks a
// direct push) - the workflow logs a warning and continues; the day-of-year
// rotation above means coverage doesn't depend on this succeeding.
writeFileSync(
	STATE_PATH,
	JSON.stringify({ triedSlugs: [...triedSlugs].sort() }, null, '\t') + '\n'
);

if (newlyFound.length > 0) {
	const merged = [...discovered, ...newlyFound];
	writeFileSync(DISCOVERED_PATH, JSON.stringify(merged, null, '\t') + '\n');
	console.log(`\nfound ${newlyFound.length} new companies, wrote to discovered-companies.json`);
} else {
	console.log('\nno new companies found this run');
}
