import { describe, expect, it } from 'vitest';
import { matchesFilters } from '../../../src/routes/jobs/shared';
import type { JobListing, JobsFilters } from '../../../src/routes/jobs/shared';

function job(overrides: Partial<JobListing> = {}): JobListing {
	return {
		id: '1',
		companyName: 'Acme',
		title: 'Engineer',
		department: null,
		locationRaw: 'Remote',
		remote: true,
		applyUrl: 'https://example.com',
		whyThisCompany: null,
		firstSeenAt: new Date().toISOString(),
		minYearsExperience: null,
		maxYearsExperience: null,
		...overrides
	};
}

const NO_FILTERS: JobsFilters = {
	remote: false,
	query: null,
	experienceMin: null,
	experienceMax: null
};

describe('matchesFilters', () => {
	it('matches everything when no filters are active', () => {
		expect(matchesFilters(job({ remote: false }), NO_FILTERS)).toBe(true);
	});

	it('requires remote when the remote filter is active', () => {
		const filters: JobsFilters = { ...NO_FILTERS, remote: true };
		expect(matchesFilters(job({ remote: true }), filters)).toBe(true);
		expect(matchesFilters(job({ remote: false }), filters)).toBe(false);
	});

	it('matches title, company, or department case-insensitively when a query is active', () => {
		const filters: JobsFilters = { ...NO_FILTERS, query: 'product manager' };
		expect(matchesFilters(job({ title: 'Senior Product Manager' }), filters)).toBe(true);
		expect(matchesFilters(job({ title: 'PRODUCT MANAGER, Growth' }), filters)).toBe(true);
		expect(matchesFilters(job({ title: 'Backend Engineer' }), filters)).toBe(false);
		expect(
			matchesFilters(job({ title: 'Engineer', companyName: 'Product Manager Co' }), filters)
		).toBe(true);
		expect(
			matchesFilters(job({ title: 'Engineer', department: 'Product Manager Team' }), filters)
		).toBe(true);
	});

	it('requires ALL active filters to pass (AND, not OR)', () => {
		const filters: JobsFilters = { ...NO_FILTERS, remote: true, query: 'engineer' };
		const remoteOnly = job({ remote: true, title: 'Product Manager' });
		expect(matchesFilters(remoteOnly, filters)).toBe(false); // query doesn't match title
		const both = job({ remote: true, title: 'Backend Engineer' });
		expect(matchesFilters(both, filters)).toBe(true);
	});

	describe('years-of-experience range filter', () => {
		it('always matches a job with no extracted years, regardless of the filter', () => {
			const filters: JobsFilters = { ...NO_FILTERS, experienceMin: 5, experienceMax: 10 };
			expect(
				matchesFilters(job({ minYearsExperience: null, maxYearsExperience: null }), filters)
			).toBe(true);
		});

		it('excludes a job whose known range does not overlap the filter range', () => {
			const filters: JobsFilters = { ...NO_FILTERS, experienceMin: 5, experienceMax: 7 };
			expect(matchesFilters(job({ minYearsExperience: 1, maxYearsExperience: 2 }), filters)).toBe(
				false
			);
			expect(
				matchesFilters(job({ minYearsExperience: 10, maxYearsExperience: null }), filters)
			).toBe(false);
		});

		it('includes a job whose known range overlaps the filter range', () => {
			const filters: JobsFilters = { ...NO_FILTERS, experienceMin: 5, experienceMax: 7 };
			expect(matchesFilters(job({ minYearsExperience: 6, maxYearsExperience: 8 }), filters)).toBe(
				true
			);
			expect(
				matchesFilters(job({ minYearsExperience: 3, maxYearsExperience: null }), filters)
			).toBe(true);
		});

		it('treats a one-sided filter (min only) as an open upper bound', () => {
			const filters: JobsFilters = { ...NO_FILTERS, experienceMin: 5, experienceMax: null };
			expect(
				matchesFilters(job({ minYearsExperience: 20, maxYearsExperience: null }), filters)
			).toBe(true);
			expect(matchesFilters(job({ minYearsExperience: 1, maxYearsExperience: 2 }), filters)).toBe(
				false
			);
		});
	});
});
