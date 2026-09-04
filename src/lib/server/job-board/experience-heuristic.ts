// non-AI years-of-experience extraction: plain regex over descriptionText,
// zero LLM calls. this is deliberately the replacement for what an earlier
// version did with an LLM classification pass (removed 2026-09-04 for
// costing too many tokens for too little reliability) - a numeric
// years-of-experience filter is still useful, but it doesn't need an LLM to
// get "5+ years" or "3-5 years of experience" out of a job description.
// imperfect by nature (a regex can't understand "several years" or
// "seasoned professional"), but free, instant, and deterministic - and every
// filter on this board already treats "couldn't determine" as "don't
// exclude" rather than "assume the worst", so misses here just mean the
// posting isn't narrowed by the filter, never that it's wrongly hidden.
export interface ExtractedExperience {
	minYears: number | null;
	maxYears: number | null;
}

const MAX_PLAUSIBLE_YEARS = 40;

export function extractYearsOfExperience(text: string): ExtractedExperience {
	if (!text) return { minYears: null, maxYears: null };

	// most specific first: an explicit range - "5-7 years", "5 to 7 years",
	// "5–7 years experience"
	const range = text.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\+?\s*years?/i);
	if (range) {
		const min = parseInt(range[1], 10);
		const max = parseInt(range[2], 10);
		if (min <= max && max <= MAX_PLAUSIBLE_YEARS) {
			return { minYears: min, maxYears: max };
		}
	}

	// "5+ years" / "5+ years of experience"
	const plus = text.match(/(\d{1,2})\+\s*years?/i);
	if (plus) {
		const min = parseInt(plus[1], 10);
		if (min <= MAX_PLAUSIBLE_YEARS) return { minYears: min, maxYears: null };
	}

	// "at least 5 years" / "minimum of 5 years" / "minimum 5 years"
	const atLeast = text.match(/(?:at least|minimum(?:\s+of)?)\s+(\d{1,2})\s*years?/i);
	if (atLeast) {
		const min = parseInt(atLeast[1], 10);
		if (min <= MAX_PLAUSIBLE_YEARS) return { minYears: min, maxYears: null };
	}

	// bare "5 years of experience" / "5 years experience" / "5 years in..."
	const bare = text.match(/(\d{1,2})\s*years?\s*(?:of\s+)?experience/i);
	if (bare) {
		const min = parseInt(bare[1], 10);
		if (min <= MAX_PLAUSIBLE_YEARS) return { minYears: min, maxYears: null };
	}

	return { minYears: null, maxYears: null };
}
