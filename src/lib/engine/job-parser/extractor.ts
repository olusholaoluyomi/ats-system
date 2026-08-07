import type { ParsedJobDescription } from './types';
import { tokenize, extractNgrams } from '$engine/nlp/tokenizer';
import { detectIndustry, getIndustrySkills } from '$engine/nlp/skills-taxonomy';

// rule-based JD extractor. LLM enhancement happens server-side. works for any industry
export function parseJobDescription(text: string): ParsedJobDescription {
	const lower = text.toLowerCase();

	// extract all meaningful tokens
	const tokens = tokenize(text);
	const terms = [...new Set(tokens.map((t) => t.normalized))];

	// extract bigrams and trigrams for multi-word skills
	const bigrams = extractNgrams(text, 2);
	const trigrams = extractNgrams(text, 3);

	// detect industry context
	const industries = detectIndustry(text);
	const industryContext = industries.length > 0 ? industries[0].industry : 'general';

	// get known skills for detected industry
	const industrySkills =
		industries.length > 0
			? getIndustrySkills(industries[0].industry).map((s) => s.toLowerCase())
			: [];

	// extract skills by matching against taxonomy + common patterns
	const extractedSkills = extractSkills(terms, bigrams, trigrams, industrySkills);

	// separate required vs preferred
	const { required, preferred } = categorizeSkills(text, extractedSkills);

	// detect experience level
	const experienceLevel = detectExperienceLevel(lower);
	const educationRequirement = detectEducationRequirement(lower);
	const roleType = detectRoleType(lower);

	// extract key phrases (important multi-word terms from the JD)
	const keyPhrases = [...bigrams, ...trigrams].filter((phrase) => isKeyPhrase(phrase)).slice(0, 20);

	return {
		rawText: text,
		extractedSkills,
		requiredSkills: required,
		preferredSkills: preferred,
		experienceLevel,
		educationRequirement,
		industryContext,
		roleType,
		keyPhrases
	};
}

function extractSkills(
	terms: string[],
	bigrams: string[],
	trigrams: string[],
	industrySkills: string[]
): string[] {
	const skills = new Set<string>();
	const industrySet = new Set(industrySkills);

	// match single terms against industry taxonomy
	for (const term of terms) {
		if (industrySet.has(term) && term.length >= 2) {
			skills.add(term);
		}
	}

	// match multi-word terms
	for (const phrase of [...bigrams, ...trigrams]) {
		if (industrySet.has(phrase)) {
			skills.add(phrase);
		}
	}

	// also catch common skill patterns not in taxonomy
	const skillPatterns = [
		// tech
		/\b(?:python|java|javascript|typescript|react|angular|vue|node\.?js|go|rust|swift|kotlin|ruby|php|c\+\+|c#|\.net|sql|nosql|mongodb|postgresql|redis|docker|kubernetes|aws|azure|gcp|terraform|jenkins|git|linux)\b/gi,
		// data/ml
		/\b(?:machine learning|deep learning|data science|nlp|natural language|computer vision|tensorflow|pytorch|pandas|spark|hadoop|tableau|power bi|etl)\b/gi,
		// business
		/\b(?:salesforce|hubspot|sap|oracle|quickbooks|excel|powerpoint|jira|confluence|asana|slack)\b/gi,
		// product management
		/\b(?:product roadmap(?:ping)?|okrs?|rice (?:framework|scoring)|kano(?: model)?|user stories|backlog (?:management|grooming)|sprint planning|stakeholder management|go-to-market|product-led growth|plg|a\/b testing|user research|shapeup|scrum master|agile ceremonies)\b/gi,
		// certifications
		/\b(?:cpa|pmp|aws certified|google certified|azure certified|cissp|ceh|six sigma|scrum master|agile)\b/gi
	];

	for (const pattern of skillPatterns) {
		const matches = terms.join(' ').match(pattern);
		if (matches) {
			for (const match of matches) {
				skills.add(match.toLowerCase());
			}
		}
	}

	return [...skills];
}

function categorizeSkills(
	text: string,
	skills: string[]
): { required: string[]; preferred: string[] } {
	const lines = text.split('\n');
	const required: string[] = [];
	const preferred: string[] = [];

	// find sections
	let inRequired = false;
	let inPreferred = false;

	for (const line of lines) {
		const lower = line.toLowerCase().trim();

		// detect section headers
		if (/(?:required|must have|minimum|essential|requirements)\b/.test(lower)) {
			inRequired = true;
			inPreferred = false;
		} else if (/(?:preferred|nice to have|bonus|desired|plus|ideal)\b/.test(lower)) {
			inRequired = false;
			inPreferred = true;
		}

		// check which skills appear in this line
		for (const skill of skills) {
			if (lower.includes(skill)) {
				if (inPreferred && !inRequired) {
					if (!preferred.includes(skill)) preferred.push(skill);
				} else {
					// default to required if section is ambiguous or explicitly required
					if (!required.includes(skill)) required.push(skill);
				}
			}
		}
	}

	// any skills not categorized go to required by default
	for (const skill of skills) {
		if (!required.includes(skill) && !preferred.includes(skill)) {
			required.push(skill);
		}
	}

	return { required, preferred };
}

function detectExperienceLevel(text: string): string {
	if (/\b(?:director|vp|vice president|head of|chief)\b/.test(text)) return 'executive';
	if (/\b(?:lead|principal|staff|architect)\b/.test(text)) return 'lead';
	if (/\b(?:senior|sr\.?)\b/.test(text) || /\b[5-9]\+?\s*(?:years?|yrs?)\b/.test(text))
		return 'senior';
	if (/\b[3-4]\+?\s*(?:years?|yrs?)\b/.test(text)) return 'mid';
	if (/\b(?:junior|jr\.?|entry)\b/.test(text) || /\b[0-2]\+?\s*(?:years?|yrs?)\b/.test(text))
		return 'entry';
	if (/\b(?:intern|internship|co-op|new grad)\b/.test(text)) return 'entry';
	return 'mid';
}

function detectEducationRequirement(text: string): string {
	if (/\b(?:ph\.?d|doctorate)\b/.test(text)) return 'PhD';
	if (/\b(?:master'?s?|mba|m\.s\.?|m\.a\.?)\b/.test(text)) return "Master's degree";
	if (/\b(?:bachelor'?s?|b\.s\.?|b\.a\.?|degree)\b/.test(text)) return "Bachelor's degree";
	if (/\b(?:associate'?s?)\b/.test(text)) return "Associate's degree";
	return 'not specified';
}

// Ordered list of (roleType, patterns[]) — checked top to bottom, first match wins.
// Order matters: more specific/compound titles are listed before broader,
// generic ones so e.g. "Technical Account Manager" resolves to
// account_management rather than the generic engineering/sales bucket, and
// "Data Engineer" resolves to data_analytics rather than plain engineering.
//
// To add a new role type or title later: add one entry to this array.
// No other code needs to change — this is the whole extension point.
const ROLE_TYPE_PATTERNS: Array<{ type: string; patterns: RegExp[] }> = [
	{
		type: 'customer_success',
		patterns: [
			/\b(customer success|client success|customer experience manager|onboarding specialist|renewals? manager|csm)\b/i
		]
	},
	{
		type: 'account_management',
		patterns: [
			/\b(account manager|account management|technical account manager|key account|client relationship manager|relationship manager)\b/i
		]
	},
	{
		type: 'customer_support',
		patterns: [
			/\b(customer support|technical support|help ?desk|support specialist|support engineer|support representative)\b/i
		]
	},
	{
		type: 'product',
		patterns: [
			/\b(product manager|product owner|product management|product lead|head of product|group product manager|associate product manager|technical product manager)\b/i
		]
	},
	{
		type: 'design',
		patterns: [
			/\b(product designer|ux designer|ui designer|graphic designer|visual designer|design lead|creative director|user experience|user interface design)\b/i,
			/\b(?:design|ux|ui|graphic|creative)\b/i
		]
	},
	{
		type: 'data_analytics',
		patterns: [
			/\b(data scientist|data analyst|data engineer|analytics engineer|business intelligence|machine learning engineer|ml engineer|ai engineer|data science)\b/i
		]
	},
	{
		type: 'engineering',
		patterns: [
			/\b(?:engineer|engineering|developer|programmer|devops|sre|software|frontend|backend|full[\s-]?stack|software development|web development|application development)\b/i
		]
	},
	{
		type: 'hr_people',
		patterns: [
			/\b(human resources|hr generalist|hr business partner|hrbp|recruiter|recruiting|talent acquisition|people operations|people ops)\b/i
		]
	},
	{
		type: 'sales',
		patterns: [/\b(?:sales|account executive|business development|sdr|bdr)\b/i]
	},
	{
		type: 'marketing',
		patterns: [
			/\b(?:marketing|market|brand|content|seo|social media|growth marketing|demand generation|communications|public relations|\bpr\b)\b/i
		]
	},
	{
		type: 'finance',
		patterns: [
			/\b(?:financial|finance|accounting|accountant|controller|audit|tax|treasury|cpa|cfa|fp&a)\b/i
		]
	},
	{
		type: 'legal',
		patterns: [/\b(?:legal|attorney|counsel|compliance|paralegal|contracts)\b/i]
	},
	{
		type: 'operations',
		patterns: [
			/\b(?:operat|supply chain|logistics|procurement|business operations|program manager|project manager)\b/i
		]
	},
	{
		type: 'consulting',
		patterns: [/\b(?:consultant|consulting|advisory)\b/i]
	},
	{
		type: 'executive',
		patterns: [
			/\b(chief executive|chief \w+ officer|\bceo\b|\bcoo\b|\bcto\b|\bcfo\b|\bcmo\b|vice president|\bvp\b|\bsvp\b|\bevp\b|president|chief of staff)\b/i
		]
	},
	{
		type: 'healthcare',
		patterns: [/\b(?:nurse|physician|clinical|patient|healthcare|medical)\b/i]
	},
	{
		type: 'administrative',
		patterns: [/\b(executive assistant|administrative assistant|office manager|\badmin\b)\b/i]
	}
];

function detectRoleType(text: string): string {
	for (const { type, patterns } of ROLE_TYPE_PATTERNS) {
		if (patterns.some((p) => p.test(text))) return type;
	}
	return 'other';
}

function isKeyPhrase(phrase: string): boolean {
	const words = phrase.split(' ');
	// filter out phrases that are too generic
	const genericWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'will', 'you', 'are']);
	if (words.every((w) => genericWords.has(w))) return false;
	if (words.some((w) => w.length <= 1)) return false;
	return true;
}
