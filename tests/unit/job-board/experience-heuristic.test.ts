import { describe, expect, it } from 'vitest';
import { extractYearsOfExperience } from '../../../src/lib/server/job-board/experience-heuristic';

describe('extractYearsOfExperience', () => {
	it('returns nulls for empty text', () => {
		expect(extractYearsOfExperience('')).toEqual({ minYears: null, maxYears: null });
	});

	it('returns nulls when no years-of-experience phrase is present', () => {
		expect(extractYearsOfExperience('We build great products for great people.')).toEqual({
			minYears: null,
			maxYears: null
		});
	});

	it('extracts an explicit range: "5-7 years"', () => {
		expect(extractYearsOfExperience('Looking for someone with 5-7 years of experience.')).toEqual({
			minYears: 5,
			maxYears: 7
		});
	});

	it('extracts a range written as "to"', () => {
		expect(extractYearsOfExperience('3 to 5 years in a similar role.')).toEqual({
			minYears: 3,
			maxYears: 5
		});
	});

	it('extracts an en-dash range', () => {
		expect(extractYearsOfExperience('2–4 years experience required.')).toEqual({
			minYears: 2,
			maxYears: 4
		});
	});

	it('extracts "X+ years"', () => {
		expect(extractYearsOfExperience('5+ years of backend engineering experience.')).toEqual({
			minYears: 5,
			maxYears: null
		});
	});

	it('extracts "at least X years"', () => {
		expect(extractYearsOfExperience('You should have at least 8 years of experience.')).toEqual({
			minYears: 8,
			maxYears: null
		});
	});

	it('extracts "minimum of X years"', () => {
		expect(extractYearsOfExperience('Minimum of 4 years in product management.')).toEqual({
			minYears: 4,
			maxYears: null
		});
	});

	it('extracts "minimum X years" (no "of")', () => {
		expect(extractYearsOfExperience('Minimum 6 years relevant experience.')).toEqual({
			minYears: 6,
			maxYears: null
		});
	});

	it('extracts a bare "X years of experience"', () => {
		expect(extractYearsOfExperience('2 years of experience with React.')).toEqual({
			minYears: 2,
			maxYears: null
		});
	});

	it('ignores implausible values above the 40-year ceiling', () => {
		expect(extractYearsOfExperience('99 years of experience required.')).toEqual({
			minYears: null,
			maxYears: null
		});
	});

	it('does not match vague phrasing like "several years" or "seasoned"', () => {
		expect(
			extractYearsOfExperience('We want a seasoned professional with several years of experience.')
		).toEqual({ minYears: null, maxYears: null });
	});

	it('prefers the range match over a looser bare match when both could apply', () => {
		expect(extractYearsOfExperience('3-5 years of experience with Node.js.')).toEqual({
			minYears: 3,
			maxYears: 5
		});
	});
});
