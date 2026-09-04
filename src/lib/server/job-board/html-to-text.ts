// minimal HTML-to-plaintext for job descriptions that only come as HTML
// (Greenhouse's `content` field - Lever and Ashby both already provide a
// plaintext field directly, see their respective ats-clients). deliberately
// not a full HTML parser/sanitizer: this text is never rendered as HTML
// (job detail pages render descriptionText as plain, Svelte-escaped text -
// see jobs/shared.ts's formatDescription for how structure like this
// function's "- " bullet markers gets turned back into real <ul>/<li>
// markup without ever trusting raw HTML), so "good enough for reading and
// for downstream structure-detection" is the bar, not "byte-perfect DOM
// equivalence" - a dedicated parsing library would be overkill for that.
export function htmlToText(html: string): string {
	return (
		html
			.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
			// <li> gets its own marker (not just a bare newline like the other
			// block tags below) so formatDescription can actually tell a list
			// apart from a paragraph on the other end - without this, Greenhouse-
			// sourced list items are indistinguishable from ordinary line breaks.
			.replace(/<li[^>]*>/gi, '\n- ')
			.replace(/<(p|div|br|h[1-6]|tr)[^>]*>/gi, '\n')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/[ \t]+/g, ' ')
			.replace(/[ \t]*\n[ \t]*/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}
