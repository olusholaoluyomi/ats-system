import { describe, expect, it } from 'vitest';
import { matchesFilters } from '../../../src/routes/jobs/+page.server';
import type { JobListing, JobsFilters } from '../../../src/routes/jobs/+page.server';

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
		classification: null,
		...overrides
	};
}

const NO_FILTERS: JobsFilters = { remote: false, relocation: false, experienceLevel: null };

describe('matchesFilters', () => {
	it('matches everything when no filters are active', () => {
		expect(matchesFilters(job({ remote: false }), NO_FILTERS)).toBe(true);
	});

	it('requires remote when the remote filter is active', () => {
		const filters: JobsFilters = { ...NO_FILTERS, remote: true };
		expect(matchesFilters(job({ remote: true }), filters)).toBe(true);
		expect(matchesFilters(job({ remote: false }), filters)).toBe(false);
	});

	it('requires relocationOffered === true (not "unclear") when the relocation filter is active', () => {
		const filters: JobsFilters = { ...NO_FILTERS, relocation: true };
		expect(
			matchesFilters(
				job({ classification: { ...classification(), relocationOffered: true } }),
				filters
			)
		).toBe(true);
		expect(
			matchesFilters(
				job({ classification: { ...classification(), relocationOffered: 'unclear' } }),
				filters
			)
		).toBe(false);
		expect(matchesFilters(job({ classification: null }), filters)).toBe(false);
	});

	it('requires an exact experienceLevel match when that filter is active', () => {
		const filters: JobsFilters = { ...NO_FILTERS, experienceLevel: 'senior' };
		expect(
			matchesFilters(
				job({ classification: { ...classification(), experienceLevel: 'senior' } }),
				filters
			)
		).toBe(true);
		expect(
			matchesFilters(
				job({ classification: { ...classification(), experienceLevel: 'mid' } }),
				filters
			)
		).toBe(false);
	});

	it('requires ALL active filters to pass (AND, not OR)', () => {
		const filters: JobsFilters = { remote: true, relocation: true, experienceLevel: null };
		const remoteOnly = job({ remote: true, classification: classification() });
		expect(matchesFilters(remoteOnly, filters)).toBe(false); // relocation not offered
		const both = job({
			remote: true,
			classification: { ...classification(), relocationOffered: true }
		});
		expect(matchesFilters(both, filters)).toBe(true);
	});
});

function classification(): NonNullable<JobListing['classification']> {
	return {
		africaRemoteFriendly: false,
		relocationOffered: 'unclear',
		relocationRequired: false,
		experienceLevel: 'unclear',
		minYearsExperience: null,
		maxYearsExperience: null,
		salaryMin: null,
		salaryMax: null,
		salaryCurrency: null,
		salaryPeriod: null
	};
}
