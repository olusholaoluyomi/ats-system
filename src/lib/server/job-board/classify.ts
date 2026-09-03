// LLM classification pass for one job posting: reuses the same
// fallback/timeout/quota-aware provider chain the scoring route uses (see
// llm-call.ts, hoisted from api/analyze/+server.ts for exactly this reuse)
// rather than a thinner reimplementation that would silently drift from it.
// only ever called for newly-inserted jobIds - see the cost-control note in
// the job-board plan.
//
// imports below are relative with explicit .ts extensions rather than the
// usual $lib/$engine aliases: this module (and everything it imports) needs
// to run both under Vite/SvelteKit AND directly via `node` (from
// scripts/ingest-jobs.mjs) - Node's native type-stripping only understands
// plain Node module resolution, not Vite's alias config.
import { callLLM } from '../llm-call.ts';
import { buildJobClassificationPrompt } from './classification-prompt.ts';

export interface JobClassification {
	africaRemoteFriendly: boolean;
	relocationOffered: boolean | 'unclear';
	relocationRequired: boolean;
	experienceLevel: 'intern' | 'entry' | 'mid' | 'senior' | 'lead' | 'unclear';
	minYearsExperience: number | null;
	maxYearsExperience: number | null;
	salaryMin: number | null;
	salaryMax: number | null;
	salaryCurrency: string | null;
	salaryPeriod: 'year' | 'month' | 'hour' | null;
	reasoning: string;
	modelProvider: string;
}

const EXPERIENCE_LEVELS = ['intern', 'entry', 'mid', 'senior', 'lead', 'unclear'] as const;
const SALARY_PERIODS = ['year', 'month', 'hour'] as const;

function asExperienceLevel(v: unknown): JobClassification['experienceLevel'] {
	return typeof v === 'string' && (EXPERIENCE_LEVELS as readonly string[]).includes(v)
		? (v as JobClassification['experienceLevel'])
		: 'unclear';
}

function asSalaryPeriod(v: unknown): JobClassification['salaryPeriod'] {
	return typeof v === 'string' && (SALARY_PERIODS as readonly string[]).includes(v)
		? (v as JobClassification['salaryPeriod'])
		: null;
}

function asNumberOrNull(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// classifies one posting. returns null (never throws) when every LLM
// provider failed - the caller leaves classification as null on the doc
// rather than blocking the rest of the ingestion run on one posting.
export async function classifyPosting(
	posting: { title: string; descriptionText: string; locationRaw: string },
	keys: Record<string, string>
): Promise<JobClassification | null> {
	if (!posting.descriptionText.trim()) return null;

	const result = await callLLM(
		() => buildJobClassificationPrompt(posting.title, posting.descriptionText, posting.locationRaw),
		keys
	);
	if (!result) return null;

	const raw = result.parsed;
	const salaryCurrency =
		typeof raw.salaryCurrency === 'string' && /^[A-Za-z]{3}$/.test(raw.salaryCurrency)
			? raw.salaryCurrency.toUpperCase()
			: null;

	return {
		africaRemoteFriendly: raw.africaRemoteFriendly === true,
		relocationOffered:
			raw.relocationOffered === true ? true : raw.relocationOffered === false ? false : 'unclear',
		relocationRequired: raw.relocationRequired === true,
		experienceLevel: asExperienceLevel(raw.experienceLevel),
		minYearsExperience: asNumberOrNull(raw.minYearsExperience),
		maxYearsExperience: asNumberOrNull(raw.maxYearsExperience),
		salaryMin: asNumberOrNull(raw.salaryMin),
		salaryMax: asNumberOrNull(raw.salaryMax),
		salaryCurrency,
		salaryPeriod: asSalaryPeriod(raw.salaryPeriod),
		reasoning: typeof raw.reasoning === 'string' ? raw.reasoning.slice(0, 500) : '',
		modelProvider: result.provider
	};
}
