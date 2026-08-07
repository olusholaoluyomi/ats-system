import { detectSections } from './section-detector';
import { extractContact } from './contact-extractor';
import { extractDateRanges, extractFirstDateRange } from './date-extractor';
import type {
	ParseResult,
	ParsedResume,
	ExperienceEntry,
	EducationEntry,
	ProjectEntry,
	CertificationEntry,
	ResumeSection,
	DateRange
} from './types';

// main entry point: parses PDF/DOCX into structured ParsedResume
export async function parseResume(file: File): Promise<ParseResult> {
	const errors: string[] = [];
	const warnings: string[] = [];

	const fileType = getFileType(file);
	if (!fileType) {
		return {
			success: false,
			resume: null,
			errors: [`unsupported file type: ${file.type || file.name.split('.').pop()}`],
			warnings: []
		};
	}

	try {
		let text: string;
		let lines: string[];
		let pageCount = 1;
		let hasMultipleColumns = false;
		let hasTables = false;
		let hasImages = false;

		// dynamic-import the per-format parser so pdfjs (~700kb) and mammoth
		// (~250kb) end up in separate chunks. a user uploading a PDF never
		// loads mammoth, and a DOCX-only user never loads pdfjs.
		if (fileType === 'pdf') {
			const { parsePDF } = await import('./pdf-parser');
			const result = await parsePDF(file);
			text = result.text;
			lines = result.lines;
			pageCount = result.pageCount;
			hasMultipleColumns = result.hasMultipleColumns;
			hasTables = result.hasTables;
			hasImages = result.hasImages;
		} else {
			const { parseDOCX } = await import('./docx-parser');
			const result = await parseDOCX(file);
			text = result.text;
			lines = result.lines;
			hasTables = result.hasTables;
			hasImages = result.hasImages;
		}

		if (text.trim().length === 0) {
			return {
				success: false,
				resume: null,
				errors: [
					'could not extract any text from the file. it may be an image-based PDF or corrupted.'
				],
				warnings: []
			};
		}

		if (hasMultipleColumns) {
			warnings.push('detected multi-column layout. text extraction order may be affected.');
		}

		if (hasTables) {
			warnings.push(
				'detected tables in the document. most ATS systems struggle with tabular layouts.'
			);
		}

		const contact = extractContact(lines);
		const sections = detectSections(lines);
		const experience = extractExperience(sections);
		const education = extractEducation(sections);
		const projects = extractProjects(sections);
		const certifications = extractCertifications(sections);
		const skills = extractSkills(sections);
		const summary = extractSummary(sections);

		const resume: ParsedResume = {
			rawText: text,
			lines,
			contact,
			sections,
			experience,
			education,
			projects,
			certifications,
			skills,
			summary,
			metadata: {
				fileType,
				pageCount,
				wordCount: text.split(/\s+/).filter(Boolean).length,
				lineCount: lines.length,
				hasMultipleColumns,
				hasTables,
				hasImages
			}
		};

		return { success: true, resume, errors, warnings };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown parsing error';
		return {
			success: false,
			resume: null,
			errors: [`failed to parse ${fileType.toUpperCase()}: ${message}`],
			warnings: []
		};
	}
}

function getFileType(file: File): 'pdf' | 'docx' | null {
	if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) return 'pdf';
	if (
		file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
		file.name.endsWith('.docx')
	)
		return 'docx';
	return null;
}

// lightweight entry point for documents that only need their raw text pulled
// out - e.g. an uploaded job description. reuses the exact same PDF/DOCX
// parsers as parseResume (same chunk-split dynamic imports, same empty-text
// and per-format error messages) but skips the resume-structure pipeline so a
// JD upload stays cheap and JD-appropriate.
export async function extractDocumentText(
	file: File
): Promise<{ success: boolean; text: string; error?: string }> {
	const fileType = getFileType(file);
	if (!fileType) {
		return {
			success: false,
			text: '',
			error: `unsupported file type: ${file.type || file.name.split('.').pop()}`
		};
	}

	try {
		let text: string;
		if (fileType === 'pdf') {
			const { parsePDF } = await import('./pdf-parser');
			const result = await parsePDF(file);
			text = result.text;
		} else {
			const { parseDOCX } = await import('./docx-parser');
			const result = await parseDOCX(file);
			text = result.text;
		}

		if (text.trim().length === 0) {
			return {
				success: false,
				text: '',
				error:
					'could not extract any text from the file. it may be an image-based PDF or corrupted.'
			};
		}

		return { success: true, text };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown parsing error';
		return {
			success: false,
			text: '',
			error: `failed to parse ${fileType.toUpperCase()}: ${message}`
		};
	}
}

// alternate entry point for users who want to paste resume text directly,
// bypassing the PDF/DOCX file-pickup step. runs the same downstream
// extraction pipeline (sections, experience, education, skills, etc) so
// the resulting ParsedResume drops into scoreResume without further
// special-casing. metadata fields that only make sense for binary
// documents (hasMultipleColumns, hasTables, hasImages) default to false;
// pageCount is estimated from word count using the standard 250 wpm
// resume rule of thumb.
export function parseResumeText(rawText: string): ParseResult {
	const text = rawText.replace(/\r\n/g, '\n').trimEnd();

	if (text.trim().length === 0) {
		return {
			success: false,
			resume: null,
			errors: ['pasted resume text is empty'],
			warnings: []
		};
	}

	const lines = text.split('\n');
	const wordCount = text.split(/\s+/).filter(Boolean).length;

	const contact = extractContact(lines);
	const sections = detectSections(lines);
	const experience = extractExperience(sections);
	const education = extractEducation(sections);
	const projects = extractProjects(sections);
	const certifications = extractCertifications(sections);
	const skills = extractSkills(sections);
	const summary = extractSummary(sections);

	const resume: ParsedResume = {
		rawText: text,
		lines,
		contact,
		sections,
		experience,
		education,
		projects,
		certifications,
		skills,
		summary,
		metadata: {
			fileType: 'pdf',
			// rough resume page estimate. 500 wpm is a high-density resume,
			// 250 is more typical, but this number only feeds a heuristic
			// pageCount scorer so a Math.ceil is plenty.
			pageCount: Math.max(1, Math.ceil(wordCount / 500)),
			wordCount,
			lineCount: lines.length,
			hasMultipleColumns: false,
			hasTables: false,
			hasImages: false
		}
	};

	return { success: true, resume, errors: [], warnings: [] };
}

// extracts structured experience entries from experience sections
function extractExperience(sections: ResumeSection[]): ExperienceEntry[] {
	const expSections = sections.filter((s) => s.type === 'experience');
	const entries: ExperienceEntry[] = [];

	for (const section of expSections) {
		const blocks = splitIntoEntries(section.content);

		for (const block of blocks) {
			const lines = block.split('\n').filter((l) => l.trim());
			if (lines.length === 0) continue;

			const firstLine = lines[0];
			const secondLine = lines.length > 1 ? lines[1] : '';
			const headerText = firstLine + ' ' + secondLine;

			const dateRange = extractFirstDateRange(headerText);
			const { title, company } = parseJobHeader(firstLine, secondLine);

			const bullets = lines
				.slice(title && company ? 2 : 1)
				.map((l) => l.replace(/^[\s•\-*·▪►➤○●]\s*/, '').trim())
				.filter((l) => l.length > 0);

			entries.push({
				title,
				company,
				dates: dateRange || { start: null, end: null, isCurrent: false },
				bullets,
				rawText: block
			});
		}
	}

	return entries;
}

// parses title/company from header. handles "Title | Co", "Title at Co", "Title, Co", two-line
function parseJobHeader(line1: string, line2: string): { title: string; company: string } {
	// remove date patterns from lines for cleaner parsing
	const cleanLine1 = line1
		.replace(
			/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}\s*[-–—]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|present|current|now)/gi,
			''
		)
		.trim();
	const cleanLine2 = line2
		.replace(
			/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}\s*[-–—]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|present|current|now)/gi,
			''
		)
		.trim();

	// try "Title | Company" or "Title - Company"
	const separatorMatch = cleanLine1.match(/^(.+?)\s*[|–—]\s*(.+)$/);
	if (separatorMatch) {
		return { title: separatorMatch[1].trim(), company: separatorMatch[2].trim() };
	}

	// try "Title at Company"
	const atMatch = cleanLine1.match(/^(.+?)\s+at\s+(.+)$/i);
	if (atMatch) {
		return { title: atMatch[1].trim(), company: atMatch[2].trim() };
	}

	// try "Title, Company"
	const commaMatch = cleanLine1.match(/^(.+?),\s*(.+)$/);
	if (commaMatch && commaMatch[2].length > 2) {
		return { title: commaMatch[1].trim(), company: commaMatch[2].trim() };
	}

	// two-line format: line1 is company or title, line2 is the other
	if (cleanLine1 && cleanLine2) {
		return { title: cleanLine2 || cleanLine1, company: cleanLine1 };
	}

	return { title: cleanLine1, company: '' };
}

// covers dotted AND dotless abbreviations, including subject suffixes the old
// `b\.?s\.?` pattern rejected. the classic failure was "B.Sc.": after matching
// "B.S" the trailing word boundary check failed on the following "c" (a word
// char), so no degree was ever recognized and the whole line was dumped into
// the institution field — making it look like the candidate had no education.
const EDU_DEGREE_REGEX =
	/\b(ph\.?d\.?|doctor(?:al|ate)?|master(?:'s)?|m\.?b\.?a\.?|m\.?a\.?(?:s)?\.?|m\.?s\.?c\.?|m\.?s\.?|m\.?eng\.?|m\.?ed\.?|bachelor(?:'s)?|b\.?b\.?a\.?|b\.?s\.?c\.?|b\.?a\.?s\.?|b\.?s\.?|b\.?a\.?|b\.?eng\.?(?:g)?\.?|b\.?tech\.?|b\.?pharm\.?|b\.?ed\.?|b\.?sc\.?|associate(?:'s)?|a\.?s\.?c\.?|a\.?s\.?|a\.?a\.?|hnd|ond|nce|diploma|certificate)(?=$|[\s,.|;:])/i;

// extracts structured education entries from education sections. entries are
// split on blank lines AND on bullet lines, because bulleted resumes (e.g.
// "• B.Sc. Computer Science | Ahmadu Bello University. | 2010") put one school
// per line with no blank-line separation, which the shared splitIntoEntries
// collapsed into a single garbage entry.
function extractEducation(sections: ResumeSection[]): EducationEntry[] {
	const eduSections = sections.filter((s) => s.type === 'education');
	const entries: EducationEntry[] = [];

	for (const section of eduSections) {
		for (const block of splitEducationBlocks(section.content)) {
			const lines = block.split('\n').filter((l) => l.trim());
			if (lines.length === 0) continue;

			const fullText = lines.join(' ');
			const dateRange = extractFirstDateRange(fullText);
			// graduation is commonly a bare year ("| 2010") that the date-range
			// extractor skips; fall back to grabbing it as the start year
			const dates = dateRange || extractGraduationYear(fullText);
			const { degree, field, institution } = parseEduHeader(lines);
			const gpa = extractGPA(fullText);
			const honors = extractHonors(lines);

			entries.push({
				degree,
				field,
				institution,
				dates,
				gpa,
				honors,
				rawText: block
			});
		}
	}

	return entries;
}

// splits education content into entries: a bullet line always starts a new
// entry, and blank lines separate multi-line (paragraph-style) entries.
function splitEducationBlocks(content: string): string[] {
	const blocks: string[] = [];
	let current: string[] = [];

	for (const raw of content.split('\n')) {
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			if (current.length > 0) {
				blocks.push(current.join('\n'));
				current = [];
			}
			continue;
		}

		const isBullet = /^\s*[•▪◦●\-*]\s*/.test(raw);
		if (isBullet && current.length > 0) {
			blocks.push(current.join('\n'));
			current = [];
		}
		current.push(raw);
	}

	if (current.length > 0) blocks.push(current.join('\n'));
	return blocks;
}

// falls back to a bare 4-digit graduation year ("| 2010") as the start date
function extractGraduationYear(text: string): DateRange {
	const yearMatch = text.match(/\b(19|20)\d{2}\b/);
	return yearMatch
		? { start: yearMatch[0], end: null, isCurrent: false }
		: { start: null, end: null, isCurrent: false };
}

function parseEduHeader(lines: string[]): { degree: string; field: string; institution: string } {
	let degree = '';
	let field = '';
	let institution = '';

	for (const line of lines) {
		const cleaned = line
			.replace(/^\s*[•▪◦●\-*]\s*/, '')
			.replace(/\d{4}\s*[-–—]\s*(?:\d{4}|present|current)/gi, '')
			.trim();
		if (!cleaned) continue;

		// "B.Sc. Computer Science | Ahmadu Bello University. | 2010"
		const parts = cleaned
			.split('|')
			.map((p) => p.trim())
			.filter(Boolean);

		if (!degree) {
			const match = cleaned.match(EDU_DEGREE_REGEX);
			if (match) {
				degree = match[0].trim();
				// field usually sits right after the degree, before a separator
				const afterDegree = cleaned.slice((match.index ?? 0) + match[0].length).trim();
				const fieldText = afterDegree
					.replace(/^(?:of|in|at)\s+/i, '')
					.match(/^[^|,–—-]+/)?.[0]
					.trim()
					.replace(/[.,;:\s]+$/, '');
				if (fieldText && !/\b(university|college|institute|school)\b/i.test(fieldText)) {
					field = fieldText;
				}
			}
		}

		// institution: a part that looks like a named organization (capitalized
		// words, possibly with small connectors) and is not the year or degree
		for (const part of parts) {
			if (/\b(19|20)\d{2}\b/.test(part)) continue;
			if (EDU_DEGREE_REGEX.test(part)) continue;
			if (/^[A-Z][A-Za-z&'.-]*(?:\s+(?:[A-Z][A-Za-z&'.-]*|[a-z]{1,3}\.?))+$/.test(part)) {
				if (!institution) institution = part.replace(/[.,;|]+$/g, '').trim();
			}
		}
	}

	// last-resort guesses when nothing structured was found
	if (!degree && !institution) {
		institution = lines[0]?.trim() || '';
		if (lines.length > 1) degree = lines[1]?.trim() || '';
	}

	return { degree, field, institution };
}

function extractGPA(text: string): string | null {
	const gpaMatch = text.match(/(?:gpa|g\.p\.a\.?)\s*:?\s*(\d+\.?\d*)\s*(?:\/\s*(\d+\.?\d*))?/i);
	if (gpaMatch) {
		return gpaMatch[2] ? `${gpaMatch[1]}/${gpaMatch[2]}` : gpaMatch[1];
	}
	return null;
}

function extractHonors(lines: string[]): string[] {
	const honorsKeywords =
		/\b(cum laude|magna cum laude|summa cum laude|dean'?s?\s*list|honors?|distinction|valedictorian|salutatorian)\b/i;
	return lines.filter((l) => honorsKeywords.test(l)).map((l) => l.trim());
}

// extracts project entries from project sections
function extractProjects(sections: ResumeSection[]): ProjectEntry[] {
	const projSections = sections.filter((s) => s.type === 'projects');
	const entries: ProjectEntry[] = [];

	for (const section of projSections) {
		const blocks = splitIntoEntries(section.content);

		for (const block of blocks) {
			const lines = block.split('\n').filter((l) => l.trim());
			if (lines.length === 0) continue;

			const name = lines[0].replace(/^[\s•\-*]\s*/, '').trim();
			const bullets = lines
				.slice(1)
				.map((l) => l.replace(/^[\s•\-*·▪►➤○●]\s*/, '').trim())
				.filter(Boolean);
			const fullText = lines.join(' ');

			// extract technologies from parentheses or "Technologies:" prefix
			const techMatch = fullText.match(/(?:\(([^)]+)\)|technologies?\s*:?\s*(.+?)(?:\.|$))/i);
			const technologies = techMatch
				? (techMatch[1] || techMatch[2])
						.split(/[,|;]/)
						.map((t) => t.trim())
						.filter(Boolean)
				: [];

			const urlMatch = fullText.match(/https?:\/\/[^\s)]+/);

			entries.push({
				name,
				description: bullets.join(' '),
				technologies,
				bullets,
				url: urlMatch ? urlMatch[0] : null,
				rawText: block
			});
		}
	}

	return entries;
}

// extracts certifications from certification sections
function extractCertifications(sections: ResumeSection[]): CertificationEntry[] {
	const certSections = sections.filter((s) => s.type === 'certifications');
	const entries: CertificationEntry[] = [];

	for (const section of certSections) {
		const lines = section.content.split('\n').filter((l) => l.trim());

		for (const line of lines) {
			const cleaned = line.replace(/^[\s•\-*·▪►➤○●]\s*/, '').trim();
			if (cleaned.length === 0) continue;

			// try to split "Certification Name - Issuer"
			const parts = cleaned.split(/\s*[-–—|]\s*/);
			const dateRange = extractFirstDateRange(cleaned);

			entries.push({
				name: parts[0].trim(),
				issuer: parts.length > 1 ? parts[1].replace(/\d{4}.*/, '').trim() : '',
				date: dateRange?.start || null,
				rawText: cleaned
			});
		}
	}

	return entries;
}

// extracts skills from skills sections. handles comma-separated, bullets, "Category: skill1, skill2"
function extractSkills(sections: ResumeSection[]): string[] {
	const skillSections = sections.filter((s) => s.type === 'skills');
	const skills: string[] = [];

	for (const section of skillSections) {
		const lines = section.content.split('\n').filter((l) => l.trim());

		for (const line of lines) {
			const cleaned = line.replace(/^[\s•\-*·▪►➤○●]\s*/, '').trim();
			if (cleaned.length === 0) continue;

			// handle "Category: skill1, skill2, skill3" format
			const colonSplit = cleaned.split(':');
			const skillPart = colonSplit.length > 1 ? colonSplit.slice(1).join(':') : cleaned;

			// split on commas, pipes, semicolons, or bullet-like separators
			const items = skillPart
				.split(/[,|;•·▪]/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0 && s.length < 50);

			skills.push(...items);
		}
	}

	// deduplicate (case-insensitive)
	const seen = new Set<string>();
	return skills.filter((skill) => {
		const key = skill.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// extracts the summary/objective section text
function extractSummary(sections: ResumeSection[]): string | null {
	const summarySection = sections.find((s) => s.type === 'summary');
	return summarySection ? summarySection.content.trim() : null;
}

// splits section content into entries using blank lines and date-containing headers as boundaries
function splitIntoEntries(content: string): string[] {
	const lines = content.split('\n');
	const entries: string[] = [];
	let current: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		// blank line might separate entries
		if (trimmed.length === 0) {
			if (current.length > 0) {
				entries.push(current.join('\n'));
				current = [];
			}
			continue;
		}

		// a line with a date range at the start of a new entry
		const hasDate = extractDateRanges(trimmed).length > 0;
		const isBullet = /^[\s•\-*·▪►➤○●]/.test(line);

		if (hasDate && !isBullet && current.length > 0 && current.some((l) => l.trim().length > 0)) {
			// check if the previous entry has bullets (indicating it's complete)
			const prevHasBullets = current.some((l) => /^[\s•\-*·▪►➤○●]/.test(l));
			if (prevHasBullets) {
				entries.push(current.join('\n'));
				current = [];
			}
		}

		current.push(line);
	}

	if (current.length > 0) {
		entries.push(current.join('\n'));
	}

	return entries.filter((e) => e.trim().length > 0);
}

// note: parsePDF and parseDOCX are NOT re-exported here. they are loaded
// only via dynamic import inside parseResume so the bundler can split
// pdfjs and mammoth into per-format chunks. external code that needs
// them directly should import from './pdf-parser' or './docx-parser'.
export { detectSections } from './section-detector';
export { extractContact } from './contact-extractor';
export { extractDateRanges, extractFirstDateRange } from './date-extractor';
export type * from './types';
