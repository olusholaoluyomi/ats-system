import { describe, it, expect } from 'vitest';
import { buildImprovedResume } from '$engine/export/improve-resume';
import type { ParsedResume } from '$engine/parser/types';
import type { ScoreResult } from '$engine/scorer/types';

const BASE = [
	'Jane Doe',
	'jane@example.com',
	'',
	'Experience',
	'- Built dashboards',
	'',
	'Education',
	'- BSc Computer Science',
	''
].join('\n');

function resumeWith(overrides: Partial<ParsedResume> = {}): ParsedResume {
	return {
		rawText: BASE,
		lines: BASE.split('\n'),
		contact: {
			name: 'Jane Doe',
			email: 'jane@example.com',
			phone: null,
			linkedin: null,
			github: null,
			website: null,
			location: null
		},
		sections: [
			{ type: 'experience', header: 'Experience', content: '- Built dashboards', startLine: 3, endLine: 5 },
			{ type: 'education', header: 'Education', content: '- BSc Computer Science', startLine: 6, endLine: 8 }
		],
		experience: [],
		education: [],
		projects: [],
		certifications: [],
		skills: [],
		summary: null,
		metadata: {
			fileType: 'text',
			pageCount: 1,
			wordCount: 10,
			lineCount: BASE.split('\n').length,
			hasMultipleColumns: false,
			hasTables: false,
			hasImages: false
		},
		...overrides
	};
}

function resultWith(missing: string[]): ScoreResult {
	return {
		system: 'Workday',
		vendor: 'TestVendor',
		overallScore: 50,
		passesFilter: false,
		breakdown: {
			formatting: { score: 50, issues: [], details: [] },
			keywordMatch: { score: 50, matched: [], missing, synonymMatched: [] },
			sections: { score: 50, present: [], missing: [] },
			experience: { score: 50, quantifiedBullets: 0, totalBullets: 0, actionVerbCount: 0, highlights: [] },
			education: { score: 50, notes: [] }
		},
		suggestions: []
	};
}

const WITH_SKILLS = [
	'Jane Doe',
	'jane@example.com',
	'',
	'Skills',
	'React, Python',
	'',
	'Experience',
	'- Built dashboards',
	'',
	'Education',
	'- BSc Computer Science',
	''
].join('\n');

describe('buildImprovedResume', () => {
	it('creates a Skills section above Experience when none exists', () => {
		const { text, applied } = buildImprovedResume(BASE, resumeWith(), [resultWith(['React', 'GraphQL'])]);
		const lines = text.split('\n');
		expect(applied).toEqual(['Added a Skills section with 2 skills']);
		expect(lines.indexOf('Skills')).toBeGreaterThan(0);
		expect(lines.indexOf('Skills')).toBeLessThan(lines.indexOf('Experience'));
		expect(lines).toContain('React');
		expect(lines).toContain('GraphQL');
	});

	it('appends only genuinely missing keywords to an existing Skills section', () => {
		const resume = resumeWith({
			skills: ['React'],
			sections: [
				{ type: 'skills', header: 'Skills', content: 'React, Python', startLine: 3, endLine: 5 },
				{ type: 'experience', header: 'Experience', content: '- Built dashboards', startLine: 6, endLine: 8 },
				{ type: 'education', header: 'Education', content: '- BSc', startLine: 9, endLine: 11 }
			]
		});
		const { text, applied } = buildImprovedResume(WITH_SKILLS, resume, [
			resultWith(['React', 'GraphQL', 'AWS'])
		]);
		expect(applied).toEqual(['Added 2 missing keywords to your Skills section']);
		// inserted at endLine+1 (index 6), one comma-joined line
		expect(text.split('\n')[6]).toBe('GraphQL, AWS');
	});

	it('dedupes keywords repeated across platforms', () => {
		const { text } = buildImprovedResume(BASE, resumeWith(), [
			resultWith(['React', 'GraphQL']),
			resultWith(['GraphQL', 'AWS'])
		]);
		const lines = text.split('\n');
		const block = lines.slice(lines.indexOf('Skills') + 1, lines.indexOf('Experience'));
		expect(block).toEqual(['React', 'GraphQL', 'AWS']);
	});

	it('leaves text unchanged when there is nothing to add', () => {
		const { text, applied } = buildImprovedResume(BASE, resumeWith(), [resultWith([])]);
		expect(text).toBe(BASE);
		expect(applied).toEqual([]);
	});
});
