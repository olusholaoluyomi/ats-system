import { describe, expect, it } from 'vitest';
import { extractCompensation } from '../../../src/lib/server/job-board/compensation-heuristic';

describe('extractCompensation', () => {
	it('extracts a dollar range', () => {
		expect(extractCompensation('The salary range for this role is $120,000 - $150,000.')).toBe(
			'$120,000 - $150,000'
		);
	});

	it('extracts a "k" shorthand range', () => {
		expect(extractCompensation('Compensation: $120k-$150k depending on experience.')).toBe(
			'$120k-$150k'
		);
	});

	it('extracts a range with other currency symbols', () => {
		expect(extractCompensation('We pay £50,000 - £65,000 per year.')).toBe(
			'£50,000 - £65,000 per year'
		);
	});

	it('appends a nearby period qualifier', () => {
		expect(extractCompensation('Base pay: $80,000 - $100,000 per year, plus equity.')).toBe(
			'$80,000 - $100,000 per year'
		);
	});

	it('returns null when there is no compensation range in the text', () => {
		expect(extractCompensation('We are looking for a great engineer to join our team.')).toBeNull();
	});

	it('returns null for a single figure with no range', () => {
		expect(extractCompensation('Up to $150,000 depending on experience.')).toBeNull();
	});
});
