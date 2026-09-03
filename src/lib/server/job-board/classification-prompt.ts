// job-board ingestion classification: reads one posting and tags whether an
// African/Nigerian remote candidate could realistically apply, whether
// relocation is offered/required, seniority, and salary if the posting
// actually states one. used by scripts/ingest-jobs.mjs via classify.ts -
// never invents numbers or claims the posting doesn't make, since this
// directly drives the job board's core promise to the user.
//
// deliberately its own file rather than living alongside
// $engine/llm/prompts.ts's resume-scoring prompts (its original home,
// stylistically consistent with buildJDAnalysisPrompt there): that file's
// top-level import of $engine/parser/section-detector (needed by OTHER
// functions in it, not this one) breaks module load entirely under plain
// `node` - and this module needs to run there too, from
// scripts/ingest-jobs.mjs via classify.ts. this function needs nothing from
// that dependency, so it doesn't need to share the risk.
export function buildJobClassificationPrompt(
	title: string,
	descriptionText: string,
	locationRaw: string
): string {
	return `You are screening a job posting for a job board aimed at African (especially Nigerian) remote job seekers. Read the posting and answer only from what it actually states - never guess or infer beyond the text.

<JOB_TITLE>
${title.slice(0, 300)}
</JOB_TITLE>

<LOCATION>
${locationRaw.slice(0, 300) || 'not specified'}
</LOCATION>

<JOB_DESCRIPTION>
${descriptionText.slice(0, 8000)}
</JOB_DESCRIPTION>

Respond ONLY with valid JSON, no markdown fences, no extra text:

{
  "africaRemoteFriendly": true or false,
  "relocationOffered": true, false, or "unclear",
  "relocationRequired": true or false,
  "experienceLevel": "intern/entry/mid/senior/lead/unclear",
  "minYearsExperience": number or null,
  "maxYearsExperience": number or null,
  "salaryMin": number or null,
  "salaryMax": number or null,
  "salaryCurrency": "3-letter code (e.g. USD) or null",
  "salaryPeriod": "year/month/hour or null",
  "reasoning": "one sentence explaining the africaRemoteFriendly/relocation calls"
}

Rules:
- africaRemoteFriendly = true only if the posting states or clearly implies remote work with no location/citizenship/timezone restriction that would exclude an applicant based in Nigeria/Africa (e.g. "remote - US only", "must be authorized to work in the EU", or a narrow onsite/hybrid requirement all count as false). If remote scope is genuinely ambiguous, default to false rather than assuming.
- relocationOffered = true only if the posting explicitly mentions relocation assistance/support/package; "unclear" if relocation isn't mentioned at all; false if it explicitly says relocation is NOT provided.
- relocationRequired = true only if the role requires physically relocating to a specific location as a condition of employment.
- salary fields: null unless the posting states an actual number or explicit range. Never estimate a "typical" salary for the role/location - a missing salary must stay null.
- experienceLevel and years: base strictly on what the posting states (title seniority, explicit years-of-experience requirement); "unclear" if genuinely not stated.`;
}
