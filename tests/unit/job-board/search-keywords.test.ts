import { describe, expect, it } from 'vitest';
import {
	buildSearchKeywords,
	tokenizeQuery
} from '../../../src/lib/server/job-board/search-keywords';

describe('buildSearchKeywords', () => {
	it('lowercases and splits title, company, and department into words', () => {
		expect(buildSearchKeywords('Senior Product Manager', 'Acme Inc', 'Growth')).toEqual(
			expect.arrayContaining(['senior', 'product', 'manager', 'acme', 'inc', 'growth'])
		);
	});

	it('drops stopwords', () => {
		const words = buildSearchKeywords('Engineer for the Platform Team', 'Acme', null);
		expect(words).not.toContain('for');
		expect(words).not.toContain('the');
	});

	it('dedupes repeated words across fields', () => {
		const words = buildSearchKeywords('Acme Engineer', 'Acme', null);
		expect(words.filter((w) => w === 'acme')).toHaveLength(1);
	});

	it('handles a null department', () => {
		expect(() => buildSearchKeywords('Engineer', 'Acme', null)).not.toThrow();
	});

	it('drops single-character tokens', () => {
		const words = buildSearchKeywords('A Engineer', 'Acme', null);
		expect(words).not.toContain('a');
	});
});

describe('tokenizeQuery', () => {
	it('tokenizes a multi-word search the same way postings are indexed', () => {
		expect(tokenizeQuery('Product Manager')).toEqual(['product', 'manager']);
	});

	it('strips stopwords and punctuation', () => {
		expect(tokenizeQuery('Engineer, for the backend-team!')).toEqual([
			'engineer',
			'backend',
			'team'
		]);
	});

	it('returns an empty array for a blank query', () => {
		expect(tokenizeQuery('   ')).toEqual([]);
	});
});
