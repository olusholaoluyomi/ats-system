import { describe, expect, it } from 'vitest';
import { formatDescription } from '../../../src/routes/jobs/shared';

describe('formatDescription', () => {
	it('returns an empty array for empty/whitespace-only text', () => {
		expect(formatDescription('')).toEqual([]);
		expect(formatDescription('   \n  ')).toEqual([]);
	});

	it('treats a single block of plain text as one paragraph', () => {
		expect(formatDescription('We are looking for a great engineer.')).toEqual([
			{ type: 'paragraph', lines: ['We are looking for a great engineer.'] }
		]);
	});

	it('splits on blank lines into separate paragraph blocks', () => {
		const text = 'First paragraph.\n\nSecond paragraph.';
		expect(formatDescription(text)).toEqual([
			{ type: 'paragraph', lines: ['First paragraph.'] },
			{ type: 'paragraph', lines: ['Second paragraph.'] }
		]);
	});

	it('detects a block where every line starts with "- " as a bullet list', () => {
		const text = '- First item\n- Second item\n- Third item';
		expect(formatDescription(text)).toEqual([
			{ type: 'bullets', lines: ['First item', 'Second item', 'Third item'] }
		]);
	});

	it('also detects "*" and "•" bullet markers', () => {
		expect(formatDescription('* One\n* Two')).toEqual([{ type: 'bullets', lines: ['One', 'Two'] }]);
		expect(formatDescription('• One\n• Two')).toEqual([{ type: 'bullets', lines: ['One', 'Two'] }]);
	});

	it('detects numbered list markers ("1." / "1)")', () => {
		expect(formatDescription('1. First\n2. Second')).toEqual([
			{ type: 'bullets', lines: ['First', 'Second'] }
		]);
		expect(formatDescription('1) First\n2) Second')).toEqual([
			{ type: 'bullets', lines: ['First', 'Second'] }
		]);
	});

	it('does not treat a paragraph with one stray dash as a bullet list', () => {
		const text = 'This role is remote-friendly\nand pays well.';
		expect(formatDescription(text)).toEqual([
			{ type: 'paragraph', lines: ['This role is remote-friendly', 'and pays well.'] }
		]);
	});

	it('handles a mix of paragraphs and bullet blocks in one description', () => {
		const text = 'About the role:\n\n- Write code\n- Ship features\n\nWe offer great benefits.';
		expect(formatDescription(text)).toEqual([
			{ type: 'paragraph', lines: ['About the role:'] },
			{ type: 'bullets', lines: ['Write code', 'Ship features'] },
			{ type: 'paragraph', lines: ['We offer great benefits.'] }
		]);
	});
});
