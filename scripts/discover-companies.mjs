/**
 * daily company discovery: pulls Y Combinator's public company dataset
 * (https://github.com/yc-oss/api - not an official YC API, but a
 * well-maintained static mirror; verified live before building this),
 * tries each active + currently-hiring company's YC slug as a board token
 * against Greenhouse/Lever/Ashby, and writes ones that actually resolve
 * into discovered-companies.json. never touches seed-companies.ts (the
 * hand-curated list) directly, and never auto-enables anything live - see
 * .github/workflows/discover-companies.yml, which opens a PR for a human to
 * review before a discovered company's jobs can appear on the board.
 *
 * candidate selection rotates through the ~1,500 active+hiring YC companies
 * by day-of-year rather than relying solely on persisted state, so full
 * pool coverage doesn't depend on every run's state-file write succeeding
 * (see the best-effort direct-push in the workflow, which can be blocked by
 * branch protection and is allowed to fail without breaking the run).
 * discovery-state.json is a skip-list optimization on top of that rotation,
 * not the only thing standing between "checked" and "not checked".
 *
 * usage: node scripts/discover-companies.mjs   (needs node 22.18+ or 24 for type stripping)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEED_COMPANIES } from '../src/lib/server/job-board/seed-companies.ts';
import { fetchGreenhouseJobs } from '../src/lib/server/job-board/ats-clients/greenhouse.ts';
import { fetchLeverJobs } from '../src/lib/server/job-board/ats-clients/lever.ts';
import { fetchAshbyJobs } from '../src/lib/server/job-board/ats-clients/ashby.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOB_BOARD_DIR = join(__dirname, '../src/lib/server/job-board');
const DISCOVERED_PATH = join(JOB_BOARD_DIR, 'discovered-companies.json');
const STATE_PATH = join(JOB_BOARD_DIR, 'discovery-state.json');

const YC_COMPANIES_URL = 'https://yc-oss.github.io/api/companies/all.json';
// polite batch size: 150 candidates x up to 3 ATS checks each = at most 450
// requests to free, unauthenticated public APIs per run, once daily.
const DAILY_BATCH_SIZE = 150;

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

// eligible pool: active, currently hiring, not already known (seeded or
// previously discovered) - triedSlugs is deliberately NOT excluded from the
// pool here, only used to skip individual entries within the rotated
// window below, so a slug that failed once can still resurface (e.g. a
// company that adds a board later).
const pool = ycCompanies.filter(
	(c) =>
		c.status === 'Active' &&
		c.isHiring === true &&
		c.slug &&
		!knownBoardTokens.has(c.slug.toLowerCase())
);

if (pool.length === 0) {
	console.log('no eligible YC candidates (all known or none currently hiring)');
	process.exit(0);
}

// rotate through the pool by day-of-year so the whole ~1,500-company set
// gets covered over time regardless of whether state persists between runs.
const start = (dayOfYear() * DAILY_BATCH_SIZE) % pool.length;
const window = [...pool.slice(start), ...pool.slice(0, start)].slice(0, DAILY_BATCH_SIZE);
const candidates = window.filter((c) => !triedSlugs.has(c.slug));

console.log(
	`checking ${candidates.length} candidates (pool ${pool.length}, ${ycCompanies.length} total YC companies, ${triedSlugs.size} previously tried)`
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
				whyThisCompany: company.one_liner
					? `YC company (${company.batch ?? 'alum'}): ${company.one_liner}`
					: `Y Combinator company (${company.batch ?? 'alum'}).`,
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
