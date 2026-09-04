// non-AI, regex-based compensation extraction from descriptionText - same
// approach and same reasoning as experience-heuristic.ts (no LLM classification
// step in this pipeline, see ingest-jobs.mjs's own comment on why). none of
// Greenhouse/Lever/Ashby's public job board APIs expose a structured salary
// field (confirmed live against real boards, not assumed), so a posting's
// pay range - when a company discloses one at all, typically because of a
// pay-transparency law - only ever shows up as plain text inside the
// description.
//
// deliberately returns the matched substring verbatim rather than parsing it
// into a structured {min, max, currency} shape: compensation text in the
// wild is too inconsistent (implicit currency, "k" abbreviations, hourly vs.
// annual, single figures vs. ranges) to safely normalize without risking a
// confidently-wrong number on the card. showing the company's own words is
// honest; inventing a parsed number is not.
const COMPENSATION_PATTERN =
	/[$£€]\s?\d[\d,]*(?:\.\d+)?\s?[kK]?\s*(?:-|–|—|to)\s*[$£€]?\s?\d[\d,]*(?:\.\d+)?\s?[kK]?/;

// a trailing period qualifier close to the match, if any - "per year" /
// "/hr" tells a reader a lot more than the bare number range alone.
const PERIOD_PATTERN = /\b(per\s?year|\/\s?yr|annually|per\s?hour|\/\s?hr|hourly|per\s?month)\b/i;

const MAX_LOOKAHEAD_CHARS = 30;

export function extractCompensation(text: string): string | null {
	const match = COMPENSATION_PATTERN.exec(text);
	if (!match) return null;

	const range = match[0].replace(/\s+/g, ' ').trim();
	const after = text.slice(
		match.index + match[0].length,
		match.index + match[0].length + MAX_LOOKAHEAD_CHARS
	);
	const periodMatch = PERIOD_PATTERN.exec(after);

	return periodMatch ? `${range} ${periodMatch[0]}` : range;
}
