// builds a preview-able "updated CV" from the parsed resume text plus the
// scan results. deterministic, no LLM: it applies the safe, actionable
// improvements the scorer already detected - specifically the missing JD
// keywords each platform flagged - and materializes a Skills section when the
// resume does not have one. bullet rewrites are intentionally NOT attempted:
// rewriting a candidate's own wording is too risky to do automatically.

import type { ParsedResume } from '$engine/parser/types';
import type { ScoreResult } from '$engine/scorer/types';

export interface ImprovedResume {
	text: string;
	applied: string[];
}

// case-insensitive dedupe that drops empties and preserves first-seen order
function dedupe(items: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of items) {
		const key = item.trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(item.trim());
	}
	return out;
}

// every "missing" keyword across all platforms is absent from the resume text
// by construction (the matcher only reports misses), so the union is safe to add
function collectMissingKeywords(results: ScoreResult[]): string[] {
	return dedupe(results.flatMap((r) => r.breakdown.keywordMatch.missing));
}

export function buildImprovedResume(
	baseText: string,
	resume: ParsedResume,
	results: ScoreResult[]
): ImprovedResume {
	const lines = baseText.replace(/\r\n/g, '\n').split('\n');
	const missing = collectMissingKeywords(results);
	const applied: string[] = [];

	const skillsSection = resume.sections.find((s) => s.type === 'skills');

	// existing Skills section: append only keywords it does not already contain
	if (skillsSection) {
		const content = lines
			.slice(skillsSection.startLine + 1, skillsSection.endLine)
			.join('\n')
			.toLowerCase();
		const toAdd = missing.filter((k) => !content.includes(k.toLowerCase()));
		if (toAdd.length === 0) {
			return { text: baseText, applied };
		}
		const insertAt = Math.min(skillsSection.endLine + 1, lines.length);
		lines.splice(insertAt, 0, toAdd.join(', '));
		applied.push(
			`Added ${toAdd.length} missing keyword${toAdd.length === 1 ? '' : 's'} to your Skills section`
		);
		return { text: lines.join('\n'), applied };
	}

	// no Skills section: create one with the missing keywords + parsed skills
	const combined = dedupe([...missing, ...resume.skills]).slice(0, 40);
	if (combined.length === 0) {
		return { text: baseText, applied };
	}

	// anchor the new section before the first career section so it lands near
	// the top (after contact/summary) instead of the bottom of the document
	const anchor = resume.sections.find(
		(s) => s.type === 'experience' || s.type === 'education' || s.type === 'projects'
	);
	const insertAt = anchor ? Math.max(anchor.startLine, 1) : lines.length;
	const needsLeadBlank = insertAt === 0 || lines[insertAt - 1].trim().length > 0;
	const block = [...(needsLeadBlank ? [''] : []), 'Skills', ...combined];
	lines.splice(insertAt, 0, ...block);
	applied.push(`Added a Skills section with ${combined.length} skills`);
	return { text: lines.join('\n'), applied };
}
