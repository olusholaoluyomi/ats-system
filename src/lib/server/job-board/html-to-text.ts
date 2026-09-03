// minimal HTML-to-plaintext for job descriptions that only come as HTML
// (Greenhouse's `content` field - Lever and Ashby both already provide a
// plaintext field directly, see their respective ats-clients). deliberately
// not a full HTML parser/sanitizer: this text is never rendered as HTML
// (job detail pages render descriptionText as plain pre-wrapped text, see
// the job-board plan), so "good enough for reading" is the bar, not
// "byte-perfect DOM equivalence" - a dedicated parsing library would be
// overkill for that.
export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<(p|div|br|li|h[1-6]|tr)[^>]*>/gi, '\n')
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
		.trim();
}
