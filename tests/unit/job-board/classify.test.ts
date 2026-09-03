import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCallLLM = vi.fn();
vi.mock('$lib/server/llm-call', () => ({
	callLLM: (...args: unknown[]) => mockCallLLM(...args)
}));

import { classifyPosting } from '../../../src/lib/server/job-board/classify';

const POSTING = {
	title: 'Backend Engineer',
	descriptionText: 'Build things.',
	locationRaw: 'Remote'
};

beforeEach(() => {
	mockCallLLM.mockReset();
});

describe('classifyPosting', () => {
	it('returns null without calling the LLM when the description is empty', async () => {
		const result = await classifyPosting({ ...POSTING, descriptionText: '  ' }, {});
		expect(result).toBeNull();
		expect(mockCallLLM).not.toHaveBeenCalled();
	});

	it('returns null when every provider fails', async () => {
		mockCallLLM.mockResolvedValue(null);
		const result = await classifyPosting(POSTING, {});
		expect(result).toBeNull();
	});

	it('maps a well-formed LLM response into the typed classification shape', async () => {
		mockCallLLM.mockResolvedValue({
			provider: 'gemini',
			parsed: {
				africaRemoteFriendly: true,
				relocationOffered: true,
				relocationRequired: false,
				experienceLevel: 'senior',
				minYearsExperience: 5,
				maxYearsExperience: 8,
				salaryMin: 80000,
				salaryMax: 100000,
				salaryCurrency: 'usd',
				salaryPeriod: 'year',
				reasoning: 'Posting explicitly allows fully remote work worldwide.'
			}
		});

		const result = await classifyPosting(POSTING, {});
		expect(result).toEqual({
			africaRemoteFriendly: true,
			relocationOffered: true,
			relocationRequired: false,
			experienceLevel: 'senior',
			minYearsExperience: 5,
			maxYearsExperience: 8,
			salaryMin: 80000,
			salaryMax: 100000,
			salaryCurrency: 'USD',
			salaryPeriod: 'year',
			reasoning: 'Posting explicitly allows fully remote work worldwide.',
			modelProvider: 'gemini'
		});
	});

	it('falls back to safe defaults for missing/malformed fields rather than inventing data', async () => {
		mockCallLLM.mockResolvedValue({ provider: 'groq', parsed: {} });

		const result = await classifyPosting(POSTING, {});
		expect(result).toEqual({
			africaRemoteFriendly: false,
			relocationOffered: 'unclear',
			relocationRequired: false,
			experienceLevel: 'unclear',
			minYearsExperience: null,
			maxYearsExperience: null,
			salaryMin: null,
			salaryMax: null,
			salaryCurrency: null,
			salaryPeriod: null,
			reasoning: '',
			modelProvider: 'groq'
		});
	});

	it('rejects a malformed 3-letter currency code rather than passing it through', async () => {
		mockCallLLM.mockResolvedValue({
			provider: 'gemini',
			parsed: { salaryCurrency: 'not-a-currency' }
		});
		const result = await classifyPosting(POSTING, {});
		expect(result?.salaryCurrency).toBeNull();
	});

	it('rejects an unrecognized experienceLevel/salaryPeriod enum value', async () => {
		mockCallLLM.mockResolvedValue({
			provider: 'gemini',
			parsed: { experienceLevel: 'staff-plus-plus', salaryPeriod: 'fortnight' }
		});
		const result = await classifyPosting(POSTING, {});
		expect(result?.experienceLevel).toBe('unclear');
		expect(result?.salaryPeriod).toBeNull();
	});
});
