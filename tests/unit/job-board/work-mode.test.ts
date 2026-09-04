import { describe, expect, it } from 'vitest';
import { deriveWorkMode } from '../../../src/lib/server/job-board/work-mode';

describe('deriveWorkMode', () => {
	it('returns remote when the remote flag is true and there is no workplaceType', () => {
		expect(deriveWorkMode(true, 'Remote - US', null)).toBe('remote');
	});

	it('defaults to onsite when nothing indicates otherwise', () => {
		expect(deriveWorkMode(false, 'San Francisco, CA', null)).toBe('onsite');
	});

	it('detects hybrid from locationRaw when there is no workplaceType', () => {
		expect(deriveWorkMode(false, 'Hybrid - New York', null)).toBe('hybrid');
	});

	it('prefers a direct workplaceType signal over the remote flag', () => {
		// Ashby can report isRemote=true on a role whose workplaceType is
		// actually "Hybrid" - the direct categorical field wins.
		expect(deriveWorkMode(true, 'San Francisco', 'Hybrid')).toBe('hybrid');
	});

	it('is case-insensitive on workplaceType', () => {
		expect(deriveWorkMode(false, '', 'REMOTE')).toBe('remote');
		expect(deriveWorkMode(false, '', 'onsite')).toBe('onsite');
	});

	it('falls back to locationRaw/remote when workplaceType is an unrecognized value', () => {
		expect(deriveWorkMode(true, '', 'flexible')).toBe('remote');
	});
});
