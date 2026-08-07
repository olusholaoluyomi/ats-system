import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// WCAG 2.1 contrast guard for design tokens and hardcoded text colors.
//
// methodology:
//   - relative luminance per WCAG 2.1 formula (sRGB gamma correction).
//   - contrast ratio = (L_lighter + 0.05) / (L_darker + 0.05).
//   - semi-transparent text tokens are alpha-composited over the page
//     background before luminance is computed.
//   - thresholds: >= 4.5:1 for normal text, >= 3:1 for large text
//     (>= 18pt / >= 14pt bold, i.e. >= 24px / >= 18.67px bold).
//
// what this catches:
//   - token regressions if someone loosens --text-tertiary back below 4.5:1.
//   - hardcoded hex colors whose contrast against the dark bg falls below AA.
//   - semi-transparent rgba text that composites to an unacceptable shade.

// ---- wcag math ----

function linearize(c255: number): number {
	const s = c255 / 255;
	return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(r: number, g: number, b: number): number {
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(l1: number, l2: number): number {
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

// composite rgba(r,g,b,alpha) over a solid background and return integer RGB
function compositeOver(
	r: number,
	g: number,
	b: number,
	alpha: number,
	bgR: number,
	bgG: number,
	bgB: number
): [number, number, number] {
	return [
		Math.round(r * alpha + bgR * (1 - alpha)),
		Math.round(g * alpha + bgG * (1 - alpha)),
		Math.round(b * alpha + bgB * (1 - alpha))
	];
}

// ---- token extraction ----

// parses --name: <value>; lines from a :root block in a css file.
// returns a map of property name to raw value string. inline /* comments */
// after a value are stripped so values survive token re-themes that annotate
// colors in place (e.g. `--text-tertiary: #818fa0; /* was #6b7a8d */`).
function parseRootTokens(css: string): Map<string, string> {
	const rootMatch = css.match(/:root\s*\{([^}]+)\}/s);
	if (!rootMatch) return new Map();
	const body = rootMatch[1];
	const map = new Map<string, string>();
	for (const line of body.split('\n')) {
		const m = line.match(/^\s*(--[a-zA-Z0-9-]+)\s*:\s*(.+?);?\s*$/);
		if (m) {
			const value = m[2]
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.trim()
				.replace(/;$/, '');
			map.set(m[1], value);
		}
	}
	return map;
}

// parses #rrggbb or #rgb to [r,g,b].
function parseHex(hex: string): [number, number, number] | null {
	const h = hex.replace('#', '');
	if (h.length === 3) {
		return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
	}
	if (h.length === 6) {
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
	}
	return null;
}

// parses rgba(r, g, b, a) to { r, g, b, a }. returns null on failure.
function parseRgba(v: string): { r: number; g: number; b: number; a: number } | null {
	const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
	if (!m) return null;
	return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

// ---- test setup ----

const tokensPath = join(process.cwd(), 'src/lib/styles/tokens.css');
const tokensCSS = readFileSync(tokensPath, 'utf-8');
const tokens = parseRootTokens(tokensCSS);

// page background is --color-bg-primary: #0a0e14
const pageBgHex = tokens.get('--color-bg-primary') ?? '#0a0e14';
const pageBgRgb = parseHex(pageBgHex) ?? [10, 14, 20];
const [bgR, bgG, bgB] = pageBgRgb;
const bgL = luminance(bgR, bgG, bgB);

// resolve a token value to a final [r,g,b] after compositing over page bg.
// supports: #rrggbb, rgba(r,g,b,a), and bare var(--token) single-level references.
function resolveToken(name: string): [number, number, number] | null {
	const raw = tokens.get(name);
	if (!raw) return null;

	// bare hex
	if (raw.startsWith('#')) return parseHex(raw);

	// rgba / rgb
	const rgba = parseRgba(raw);
	if (rgba) {
		if (rgba.a >= 0.999) return [rgba.r, rgba.g, rgba.b];
		return compositeOver(rgba.r, rgba.g, rgba.b, rgba.a, bgR, bgG, bgB);
	}

	// single-level var() reference
	const varMatch = raw.match(/^var\((--[a-zA-Z0-9-]+)\)$/);
	if (varMatch) return resolveToken(varMatch[1]);

	return null;
}

function ratio(name: string): number {
	const rgb = resolveToken(name);
	if (!rgb) throw new Error(`cannot resolve token ${name}`);
	const textL = luminance(...rgb);
	return contrastRatio(bgL, textL);
}

function ratioHex(hex: string): number {
	const rgb = parseHex(hex);
	if (!rgb) throw new Error(`cannot parse hex ${hex}`);
	const textL = luminance(...rgb);
	return contrastRatio(bgL, textL);
}

function ratioRgba(r: number, g: number, b: number, a: number): number {
	const [cr, cg, cb] = compositeOver(r, g, b, a, bgR, bgG, bgB);
	const textL = luminance(cr, cg, cb);
	return contrastRatio(bgL, textL);
}

// contrast of text over a tinted glass button background.
// many UI components use a button bg of rgba(accent, alpha) over the page bg,
// then place the accent color as text. we composite the button bg first, then
// check text against that composited surface.
function ratioTextOnTintedBg(
	textHex: string,
	bgAccentR: number,
	bgAccentG: number,
	bgAccentB: number,
	bgAccentA: number
): number {
	const [btnBgR, btnBgG, btnBgB] = compositeOver(
		bgAccentR,
		bgAccentG,
		bgAccentB,
		bgAccentA,
		bgR,
		bgG,
		bgB
	);
	const btnBgL = luminance(btnBgR, btnBgG, btnBgB);
	const textRgb = parseHex(textHex);
	if (!textRgb) throw new Error(`cannot parse hex ${textHex}`);
	const textL = luminance(...textRgb);
	return contrastRatio(btnBgL, textL);
}

// ---- tests ----

const BODY_TEXT_MIN = 4.5; // wcag AA normal text
const UI_TEXT_MIN = 3.0; // wcag AA large text / UI components >= 18pt or 14pt bold

describe('wcag 2.1 AA contrast: design token pairs on --color-bg-primary (#0a0e14)', () => {
	it('--text-primary on bg meets 4.5:1 (body text floor)', () => {
		expect(ratio('--text-primary')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('--text-secondary on bg meets 4.5:1 (body text floor)', () => {
		expect(ratio('--text-secondary')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('--text-tertiary on bg meets 4.5:1 (body text floor, solid #818fa0 = 5.8:1)', () => {
		// this is the token most at risk. it was at rgba(255,255,255,0.4) = 3.78:1
		// before the first audit (failed AA), then rgba(255,255,255,0.5) = 5.36:1,
		// then hardened to solid #818fa0 in the re-theme.
		expect(ratio('--text-tertiary')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('--text-accent (#c6ff00) on bg meets 4.5:1 (used as link/focus color)', () => {
		expect(ratio('--text-accent')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('--accent-blue on bg meets 4.5:1 (used in button text)', () => {
		expect(ratioHex('#3b82f6')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('--accent-green on bg meets 4.5:1 (used in pass/success labels)', () => {
		expect(ratioHex('#10b981')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('--accent-amber on bg meets 4.5:1 (used in warning labels)', () => {
		expect(ratioHex('#f59e0b')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('--accent-red on bg meets 4.5:1 (used in error/fail labels)', () => {
		expect(ratioHex('#ef4444')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('--accent-purple on bg meets 4.5:1 (used in badge/decorative text)', () => {
		expect(ratioHex('#8b5cf6')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});
});

describe('wcag 2.1 AA contrast: hardcoded text colors in components', () => {
	it('#22c55e (green status text) on bg meets 4.5:1', () => {
		expect(ratioHex('#22c55e')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('#ef4444 (red status text) on bg meets 4.5:1', () => {
		expect(ratioHex('#ef4444')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('#eab308 (yellow warning text) on bg meets 4.5:1', () => {
		expect(ratioHex('#eab308')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('#ec4899 (pink accent text) on bg meets 4.5:1', () => {
		expect(ratioHex('#ec4899')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	it('#ffdd00 (yellow badge text) on bg meets 4.5:1', () => {
		expect(ratioHex('#ffdd00')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	// ScoreCard keyword-label: was rgba(239,68,68,0.7) = 3.02:1 before this audit.
	// fixed to use #ef4444 directly, which is 5.21:1.
	it('#ef4444 (keyword-label missing, post-audit) on bg meets 4.5:1', () => {
		expect(ratioHex('#ef4444')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	// ScoreCard keyword-label matched: was rgba(34,197,94,0.7) = 4.63:1, which
	// technically passed but was fragile. fixed to use var(--accent-green) = #10b981 = 7.73:1.
	it('#10b981 (keyword-label matched, post-audit) on bg meets 4.5:1', () => {
		expect(ratioHex('#10b981')).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	// rgba semi-transparent text that the pre-audit sweep caught.
	// the matched-label rgba(34,197,94,0.7) composites to 4.63:1, which just
	// cleared the bar, but was removed in favour of the solid token above.
	it('rgba(34,197,94,0.7) composited on bg meets 3:1 (historical reference)', () => {
		expect(ratioRgba(34, 197, 94, 0.7)).toBeGreaterThanOrEqual(UI_TEXT_MIN);
	});
});

describe('wcag 2.1 AA contrast: UI component text on tinted glass backgrounds', () => {
	// ShareBadge linkedin button: bg = rgba(10,102,194,0.15) over page bg.
	// text was #0a66c2 = 3.10:1 on that tinted surface (fail). fixed to
	// var(--accent-blue) = #3b82f6 = 4.79:1.
	it('--accent-blue (#3b82f6) on linkedin-tinted btn bg meets 4.5:1', () => {
		const r = ratioTextOnTintedBg('#3b82f6', 10, 102, 194, 0.15);
		expect(r).toBeGreaterThanOrEqual(BODY_TEXT_MIN);
	});

	// primary button: bg = rgba(6,182,212,0.12), text = #06b6d4.
	it('#06b6d4 (cyan) on cyan-tinted btn bg meets 3:1 (large text button)', () => {
		const r = ratioTextOnTintedBg('#06b6d4', 6, 182, 212, 0.12);
		expect(r).toBeGreaterThanOrEqual(UI_TEXT_MIN);
	});
});

describe('wcag 2.1 AA contrast: token extraction sanity', () => {
	it('parsed --color-bg-primary as #0a0e14', () => {
		expect(tokens.get('--color-bg-primary')).toBe('#0a0e14');
	});

	// returns the opacity of a token after resolving a single-level var() ref.
	// solid hex counts as fully opaque (1.0); only rgba() carries real alpha.
	function opacityOf(name: string): number | null {
		const raw = tokens.get(name);
		if (!raw) return null;
		if (raw.startsWith('#')) return 1;
		const rgba = parseRgba(raw);
		if (rgba) return rgba.a;
		const varMatch = raw.match(/^var\((--[a-zA-Z0-9-]+)\)$/);
		if (varMatch) return opacityOf(varMatch[1]);
		return null;
	}

	it('parsed --text-primary as solid hex (opacity 1.0 >= 0.9)', () => {
		const opacity = opacityOf('--text-primary');
		expect(opacity).not.toBeNull();
		expect(opacity!).toBeGreaterThanOrEqual(0.9);
	});

	it('parsed --text-tertiary with opacity >= 0.49 (floor set by this audit)', () => {
		// a semi-transparent tertiary at 0.49 composites to 5.14:1 (still AA).
		// the re-theme hardened it to solid #818fa0 (5.8:1); if anyone drops it
		// below this floor this test catches the regression.
		const opacity = opacityOf('--text-tertiary');
		expect(opacity).not.toBeNull();
		expect(opacity!).toBeGreaterThanOrEqual(0.49);
	});
});
