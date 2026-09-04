import { describe, expect, it } from 'vitest';
import { mapJobDoc } from '../../../src/routes/jobs/shared';

describe('mapJobDoc', () => {
	it('reads workMode, compensationText, and relocationSupport when present', () => {
		const job = mapJobDoc('1', {
			workMode: 'hybrid',
			compensationText: '$120,000 - $150,000',
			relocationSupport: true
		});

		expect(job.workMode).toBe('hybrid');
		expect(job.compensationText).toBe('$120,000 - $150,000');
		expect(job.relocationSupport).toBe(true);
	});

	it('defaults workMode to onsite for an unrecognized or missing value', () => {
		expect(mapJobDoc('1', {}).workMode).toBe('onsite');
		expect(mapJobDoc('1', { workMode: 'not-a-real-value' }).workMode).toBe('onsite');
	});

	it('defaults compensationText to null and relocationSupport to false when absent', () => {
		const job = mapJobDoc('1', {});
		expect(job.compensationText).toBeNull();
		expect(job.relocationSupport).toBe(false);
	});
});
