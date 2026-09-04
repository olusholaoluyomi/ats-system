// non-AI, regex-based detection of "this company supports relocation" from
// descriptionText - same approach as experience-heuristic.ts and
// compensation-heuristic.ts. deliberately narrow: only matches phrases where
// the COMPANY is offering relocation support, never a phrase like "must be
// willing to relocate" (that's a requirement on the candidate, the opposite
// signal, and would be actively misleading to surface as a perk).
const RELOCATION_PATTERNS = [
	/relocation\s+(?:assistance|support|package|benefits?|allowance|bonus)/i,
	/we\s+(?:offer|provide|cover)\s+relocation/i,
	/open\s+to\s+relocat(?:e|ion|ing)\s+candidates/i,
	/relocation\s+is\s+(?:available|provided|offered)/i,
	/(?:full|partial)\s+relocation\s+(?:cover(?:ed|age)?|paid)/i
];

export function detectsRelocationSupport(text: string): boolean {
	return RELOCATION_PATTERNS.some((pattern) => pattern.test(text));
}
