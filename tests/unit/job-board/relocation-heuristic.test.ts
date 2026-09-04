import { describe, expect, it } from 'vitest';
import { detectsRelocationSupport } from '../../../src/lib/server/job-board/relocation-heuristic';

describe('detectsRelocationSupport', () => {
	it('detects "relocation assistance"', () => {
		expect(detectsRelocationSupport('We offer relocation assistance for this role.')).toBe(true);
	});

	it('detects "relocation package"', () => {
		expect(detectsRelocationSupport('A generous relocation package is available.')).toBe(true);
	});

	it('detects "open to relocation candidates"', () => {
		expect(detectsRelocationSupport('We are open to relocation candidates.')).toBe(true);
	});

	it('returns false for a plain description with no relocation mention', () => {
		expect(detectsRelocationSupport('We are looking for a great engineer to join our team.')).toBe(
			false
		);
	});

	it('does not treat "must be willing to relocate" as company-offered support', () => {
		expect(
			detectsRelocationSupport('Candidates must be willing to relocate to our HQ if required.')
		).toBe(false);
	});
});
