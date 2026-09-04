import { describe, expect, it } from 'vitest';
import { htmlToText } from '../../../src/lib/server/job-board/html-to-text';

describe('htmlToText', () => {
	it('strips tags and preserves paragraph breaks', () => {
		const html = '<p>First paragraph.</p><p>Second paragraph.</p>';
		expect(htmlToText(html)).toBe('First paragraph.\nSecond paragraph.');
	});

	it('converts list items onto their own lines', () => {
		const html = '<ul><li>One</li><li>Two</li></ul>';
		const result = htmlToText(html);
		expect(result).toContain('One');
		expect(result).toContain('Two');
	});

	it('marks list items with a "- " prefix, distinct from a plain paragraph break', () => {
		// this marker is what lets formatDescription (jobs/shared.ts) tell a
		// real list apart from an ordinary line break downstream - without it,
		// <li> and <p>/<br> would be indistinguishable after stripping.
		const html = '<ul><li>First item</li><li>Second item</li></ul>';
		expect(htmlToText(html)).toBe('- First item\n- Second item');
	});

	it('decodes common HTML entities', () => {
		expect(htmlToText('Ben &amp; Jerry&#39;s &lt;3')).toBe("Ben & Jerry's <3");
	});

	it('strips script and style content entirely', () => {
		const html = '<p>Visible</p><script>evil()</script><style>.x{color:red}</style>';
		const result = htmlToText(html);
		expect(result).toContain('Visible');
		expect(result).not.toContain('evil()');
		expect(result).not.toContain('color:red');
	});

	it('collapses excess blank lines', () => {
		const html = '<p>A</p><br><br><br><p>B</p>';
		expect(htmlToText(html)).not.toMatch(/\n{3,}/);
	});
});
