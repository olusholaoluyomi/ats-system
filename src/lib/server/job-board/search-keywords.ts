// Firestore has no full-text/substring search - the job board's search used
// to fetch a capped batch of recent postings and filter them in memory
// (jobs/shared.ts's matchesFilters), which meant a search term could miss
// real matches sitting outside that capped batch, and every page view paid
// for reading the whole batch regardless of what was actually searched for.
// this is the standard Firestore workaround: store a lowercase keyword array
// per posting at ingestion time, then query with array-contains-any at read
// time (see jobs/+page.server.ts) so a search is an actual narrowed
// Firestore query, not client-side filtering of an already-fetched page.
//
// tradeoff: array-contains-any is OR semantics (matches ANY of the query's
// words), not an exact phrase/AND match - "product manager" also surfaces a
// posting that only mentions "product" or only "manager". that's a real
// precision loss vs. the old in-memory substring check, but it's an honest
// one: it's a real DB-level narrowing instead of a fixed-size in-memory
// scan, and multi-word job-title searches still rank their exact matches
// first in practice since those postings hit more of the OR'd keywords.
const STOPWORDS = new Set([
	'a',
	'an',
	'and',
	'at',
	'for',
	'in',
	'of',
	'on',
	'or',
	'the',
	'to',
	'with'
]);

// Firestore array-contains-any accepts at most 30 values per query, and a
// document's own array field has no hard limit worth worrying about here -
// this cap just keeps a pathologically long title/company from ballooning
// doc size.
const MAX_KEYWORDS = 25;

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// computed once at ingestion time (dedupe-and-write.ts) and stored on the
// job doc as searchKeywords - deduped, order doesn't matter for
// array-contains-any.
export function buildSearchKeywords(
	title: string,
	companyName: string,
	department: string | null
): string[] {
	const words = [
		...tokenize(title),
		...tokenize(companyName),
		...(department ? tokenize(department) : [])
	];
	return [...new Set(words)].slice(0, MAX_KEYWORDS);
}

// the query-side counterpart: turns a user's free-text search into the
// (at most 30, per Firestore's array-contains-any limit) keywords to query
// against. stopwords are stripped the same way so "engineer for the team"
// searches on ["engineer","team"], matching how postings were indexed.
export function tokenizeQuery(query: string): string[] {
	return tokenize(query).slice(0, 30);
}
