// curated list of companies the job-board ingestion pulls from. this list IS
// the "global organization" filter: rather than trying to infer "is this a
// legitimate global org" from a single job posting's text, we only ever
// ingest from companies vetted here - add/remove entries via PR review, the
// same way the codebase already prefers reviewed config over an
// admin-editable Firestore doc (see billing-config.ts).
//
// `boardToken` is each ATS's own identifier for the company's board:
//   - greenhouse: the slug in boards.greenhouse.io/{slug} or the board API
//     URL boards-api.greenhouse.io/v1/boards/{slug}/jobs
//   - lever: the slug in jobs.lever.co/{slug}
//   - ashby: the slug in jobs.ashbyhq.com/{slug}
// A guessed company-name slug is often wrong (companies rename boards,
// migrate ATS providers, or use an unrelated token) - every entry below was
// verified live against its actual API before being added. When adding a
// new one, verify it resolves (a non-empty `jobs` array, or an empty-but-200
// response) before committing it; a wrong token doesn't error, it just
// silently ingests nothing for that company.
//
// this starter list is a starting point for curation, not a verified claim
// that any of these companies specifically hire Africans/Nigerians remotely
// or offer relocation - the board no longer makes per-posting claims like
// that at all (an earlier LLM-classification pass over each posting did,
// but it burned too many tokens for too little reliability and was
// removed; see the commit history around 2026-09-04). `whyThisCompany`
// below is a hand-written curation note, not an extracted fact.
export interface SeedCompany {
	slug: string;
	name: string;
	atsType: 'greenhouse' | 'lever' | 'ashby';
	boardToken: string;
	whyThisCompany?: string;
	enabled: boolean;
}

export const SEED_COMPANIES: SeedCompany[] = [
	{
		slug: 'gitlab',
		name: 'GitLab',
		atsType: 'greenhouse',
		boardToken: 'gitlab',
		whyThisCompany: 'All-remote by design since founding; publishes its remote playbook publicly.',
		enabled: true
	},
	{
		slug: 'remote-com',
		name: 'Remote',
		atsType: 'greenhouse',
		boardToken: 'remotecom',
		whyThisCompany: 'Global employment/payroll platform whose own team is fully remote.',
		enabled: true
	},
	{
		slug: 'coinbase',
		name: 'Coinbase',
		atsType: 'greenhouse',
		boardToken: 'coinbase',
		whyThisCompany: 'Large global crypto exchange with a substantial remote-eligible workforce.',
		enabled: true
	},
	{
		slug: 'toptal',
		name: 'Toptal',
		atsType: 'lever',
		boardToken: 'toptal',
		whyThisCompany: "Describes itself as the world's largest fully remote workforce.",
		enabled: true
	},
	{
		slug: 'deel',
		name: 'Deel',
		atsType: 'ashby',
		boardToken: 'deel',
		whyThisCompany: 'Global payroll/EOR platform, remote-first team across 100+ countries.',
		enabled: true
	},
	{
		slug: 'ramp',
		name: 'Ramp',
		atsType: 'ashby',
		boardToken: 'ramp',
		whyThisCompany: 'Global fintech; several engineering roles are remote-eligible.',
		enabled: true
	},
	{
		slug: 'linear',
		name: 'Linear',
		atsType: 'ashby',
		boardToken: 'linear',
		whyThisCompany: 'Explicitly remote-first product/engineering team.',
		enabled: true
	},
	{
		slug: 'vanta',
		name: 'Vanta',
		atsType: 'ashby',
		boardToken: 'vanta',
		whyThisCompany: 'Global security-compliance company with US-remote and international roles.',
		enabled: true
	}
];
