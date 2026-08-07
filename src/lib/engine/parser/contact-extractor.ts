import type { ContactInfo } from './types';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// NA-style: optional +1, optional (area code), 3 digits - 4 digits
const PHONE_REGEX = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/;
// international: + country code (1-3 digits) followed by 6-14 more digits,
// with optional spaces/dashes/dots between groups. Tried first so numbers
// like "+234 814 807 5891" or "+2348148075891" match as a whole rather than
// having the NA regex grab a random 7-digit substring out of the middle.
const INTL_PHONE_REGEX = /\+\d{1,3}[-.\s]?(?:\d[-.\s]?){6,14}\d/;
// matches linkedin.com/in/user, linkedin.com/user, and PDF-mangled variants with spaces
const LINKEDIN_REGEX = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in\/)?[\w-]+\/?/i;
const GITHUB_REGEX = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i;
const WEBSITE_REGEX =
	/https?:\/\/(?!.*(?:linkedin|github)\.com)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/\S*)?/i;

// extracts contact info from the top ~15 lines of the resume
export function extractContact(lines: string[]): ContactInfo {
	const searchLines = lines.slice(0, Math.min(lines.length, 15));
	// clean PDF artifacts: collapse multiple spaces, fix common ligature issues
	const searchText = searchLines.map((l) => l.replace(/\s{2,}/g, ' ')).join('\n');

	const email = extractFirst(searchText, EMAIL_REGEX);
	const phone = extractFirst(searchText, INTL_PHONE_REGEX) ?? extractFirst(searchText, PHONE_REGEX);
	const linkedin = extractLinkedIn(searchText);
	const github = extractFirst(searchText, GITHUB_REGEX);
	const website = extractFirst(searchText, WEBSITE_REGEX);
	const name = extractName(searchLines);
	const location = extractLocation(searchLines);

	return { name, email, phone, linkedin, github, website, location };
}

// linkedin needs special handling because PDF extraction often mangles URLs
function extractLinkedIn(text: string): string | null {
	// try standard regex first
	const standard = extractFirst(text, LINKEDIN_REGEX);
	if (standard) return standard;

	// fallback: look for "linkedin" keyword near a path-like string
	// handles cases like "LinkedIn: /in/sunnypatell" or "linkedin .com/in/sunny"
	const fallback = /linkedin\s*\.?\s*com\s*\/\s*(?:in\s*\/\s*)?([\w-]+)/i;
	const match = text.match(fallback);
	if (match) return `linkedin.com/in/${match[1]}`;

	return null;
}

function extractFirst(text: string, regex: RegExp): string | null {
	const match = text.match(regex);
	return match ? match[0].trim() : null;
}

// extracts candidate name from first few lines (short, non-url, 2-5 word line)
function extractName(lines: string[]): string | null {
	for (const line of lines.slice(0, 5)) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		if (trimmed.length > 50) continue;

		// skip if it contains obvious non-name content
		if (EMAIL_REGEX.test(trimmed)) continue;
		if (PHONE_REGEX.test(trimmed)) continue;
		if (/https?:\/\//.test(trimmed)) continue;
		if (/linkedin|github/i.test(trimmed)) continue;

		// name should have 2-5 words, all alphabetic (with possible hyphens/periods).
		// Strip a single "Lastname," comma first so "OLUYOMI, OLUSHOLA MICHAEL"
		// style names (common outside the US) aren't rejected outright.
		const withoutComma = trimmed.replace(/,/g, '');
		const words = withoutComma.split(/\s+/);
		if (words.length >= 2 && words.length <= 5) {
			const allAlpha = words.every((w) => /^[a-zA-Z][a-zA-Z.\-']*$/.test(w));
			if (allAlpha) return trimmed.replace(/,\s*/g, ', ').trim();
		}
	}

	return null;
}

// extracts location from contact section (e.g. "City, State" or "City, ST ZIP")
function extractLocation(lines: string[]): string | null {
	const locationPatterns = [
		// City, ST
		/[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}\b/,
		// City, State
		/[A-Z][a-zA-Z\s]+,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?/,
		// City, ST ZIP
		/[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}\s+\d{5}/,
		// City, Country
		/[A-Z][a-zA-Z\s]+,\s*[A-Z][a-zA-Z\s]+/
	];

	for (const line of lines.slice(0, 10)) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		// skip all-caps lines: resumes commonly render the candidate's name
		// in all caps at the top, and it would otherwise match the
		// "City, Country" pattern before the real location line is reached
		if (trimmed.length > 3 && trimmed === trimmed.toUpperCase()) continue;

		// contact lines are often crammed onto one line with a delimiter,
		// e.g. "Lagos, Nigeria (Remote-ready) | email@x.com | +234...".
		// Check each segment on its own so a phone/email elsewhere on the
		// same line doesn't disqualify the location segment.
		const segments = trimmed.split(/\s*[|•]\s*/);

		for (const segment of segments) {
			if (EMAIL_REGEX.test(segment)) continue;
			if (PHONE_REGEX.test(segment)) continue;
			if (INTL_PHONE_REGEX.test(segment)) continue;
			if (/https?:\/\//.test(segment)) continue;

			for (const pattern of locationPatterns) {
				const match = segment.match(pattern);
				if (match) {
					const loc = match[0].trim();
					// filter out false positives
					if (loc.length > 5 && loc.length < 60) return loc;
				}
			}
		}
	}

	return null;
}
