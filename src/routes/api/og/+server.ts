import { ImageResponse } from '@vercel/og';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clamp, parseInt0 } from '$lib/clamp';
import type { RequestHandler } from './$types';

// runs on the default (node) serverless runtime - the deprecated `runtime: 'edge'`
// adapter-vercel option pulls SvelteKit's bundled root.js (which references
// node:crypto via dynamic import) into an edge-only build that esbuild fails to
// resolve. @vercel/og >=0.6 works fine on node-runtime serverless functions
export const config = { maxDuration: 30 };

const WIDTH = 1200;
const HEIGHT = 630;

// design tokens mirror src/lib/styles/tokens.css (dark theme) so the share
// card matches the platform's current look: ink background, lime/cyan accents,
// Archivo Black display type + JetBrains Mono labels, sharp 2-6px corners.
const INK = '#0a0e14';
const SURFACE = '#111820';
const BORDER = 'rgba(255, 255, 255, 0.08)';
const LIME = '#c6ff00';
const CYAN = '#00e0ff';
const TEXT_PRIMARY = '#e8edf5';
const TEXT_SECONDARY = '#9aa3b8';
const TEXT_TERTIARY = '#818fa0';

// score-tier colors mirror src/lib/engine/scorer/classification.ts
function tierColor(score: number): string {
	if (score >= 80) return '#22c55e';
	if (score >= 60) return '#eab308';
	if (score >= 40) return '#f97316';
	return '#ef4444';
}

function tierLabel(score: number): string {
	if (score >= 80) return 'EXCELLENT';
	if (score >= 60) return 'GOOD';
	if (score >= 40) return 'NEEDS WORK';
	return 'POOR';
}

// font files live in static/fonts (same trick as the docs route: node runtime
// resolves them via process.cwd() on Vercel). loaded lazily once per cold
// start; a missing font silently falls back to satori's bundled font so the
// endpoint never 500s over a font.
type FontWeight = 400 | 500 | 600 | 700;

interface FontFace {
	name: string;
	data: ArrayBuffer;
	weight: FontWeight;
	style: 'normal';
}

let fontFaces: FontFace[] | null = null;

// static (non-variable) font files only - @vercel/og's bundled opentype parser
// throws on the `fvar` table of variable fonts. weights map to the exact file
// served per weight, so a missing weight just isn't registered and satori falls
// back to the nearest registered one.
function pushFaces(
	faces: FontFace[],
	dir: string,
	name: string,
	files: [FontWeight, string][]
): void {
	for (const [weight, file] of files) {
		try {
			const buf = readFileSync(resolve(dir, file));
			faces.push({
				name,
				data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
				weight,
				style: 'normal'
			});
		} catch {
			// font missing or unreadable -> skip
		}
	}
}

function loadFontFaces(): FontFace[] {
	if (fontFaces) return fontFaces;
	const dir = resolve(process.cwd(), 'static', 'fonts');
	const faces: FontFace[] = [];
	pushFaces(faces, dir, 'ArchivoBlack', [[400, 'ArchivoBlack-Regular.ttf']]);
	pushFaces(
		faces,
		dir,
		'Archivo',
		[400, 500, 600, 700].map((weight) => [weight, `Archivo-${weight}.woff`]) as [
			FontWeight,
			string
		][]
	);
	pushFaces(
		faces,
		dir,
		'JetBrainsMono',
		[400, 500, 700].map((weight) => [weight, `JetBrainsMono-${weight}.ttf`]) as [
			FontWeight,
			string
		][]
	);
	fontFaces = faces;
	return faces;
}

// function-level LRU memo of rendered PNG bytes. the vercel cdn cache
// already absorbs identical repeat requests by URL, but a cache-bypass
// header (Cache-Control: no-cache from a misconfigured client, a fresh
// edge region, etc) lands on the function and re-renders the same image.
// 200 entries x ~60kb per image is ~12MB of resident memory, well within
// vercel hobby's per-function ceiling. keys are content-addressed so
// collisions are not possible.
const renderCache = new Map<string, ArrayBuffer>();
const RENDER_CACHE_MAX = 200;

function cacheKey(score: number, pass: number, total: number, delta: number | null): string {
	return `${score}|${pass}|${total}|${delta ?? ''}`;
}

export const GET: RequestHandler = async ({ url }) => {
	const score = parseInt0(url.searchParams.get('score'), 0, 0, 100);
	// parse total first, then cap pass to <= total so a tampered URL like
	// ?pass=6&total=1 cannot render "6 of 1 ATS systems passed"
	const total = parseInt0(url.searchParams.get('total'), 6, 1, 6);
	const pass = clamp(parseInt0(url.searchParams.get('pass'), 0, 0, 6), 0, total);
	const delta = url.searchParams.has('delta')
		? parseInt0(url.searchParams.get('delta'), 0, -100, 100)
		: null;

	// memo lookup: content-addressed by the four params that drive the image
	const memoKey = cacheKey(score, pass, total, delta);
	const cached = renderCache.get(memoKey);
	if (cached) {
		// LRU bump on hit
		renderCache.delete(memoKey);
		renderCache.set(memoKey, cached);
		return new Response(cached, {
			status: 200,
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control':
					'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800, immutable',
				// override the global same-origin CORP set in hooks.server.ts:
				// social platforms (LinkedIn, Twitter, Facebook, Slack) fetch og images
				// from their own origin when generating link previews. same-origin would
				// block those cross-origin fetches and break every social share card.
				// cross-origin is safe here because this endpoint only serves a static
				// pre-rendered PNG with no user-sensitive data.
				'Cross-Origin-Resource-Policy': 'cross-origin'
			}
		});
	}

	const color = tierColor(score);
	const label = tierLabel(score);

	// hero-section-style card: badge pill, Archivo Black headline, giant score,
	// a stats strip mirroring the landing hero, and a mono footer.
	// React-element tree built as plain objects so we don't need JSX in the
	// project. satori (under @vercel/og) accepts this shape directly.
	const tree = {
		type: 'div',
		props: {
			style: {
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'space-between',
				// ink background + two soft "mesh orb" radial glows (lime/cyan)
				background: `radial-gradient(circle at 18% 8%, rgba(198, 255, 0, 0.1), transparent 42%), radial-gradient(circle at 84% 92%, rgba(0, 224, 255, 0.12), transparent 45%), ${INK}`,
				color: TEXT_PRIMARY,
				padding: '52px 64px 48px',
				fontFamily: 'Archivo, system-ui, sans-serif'
			},
			children: [
				// header strip: brand left, hero trust badge right
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							gap: '24px'
						},
						children: [
							{
								type: 'div',
								props: {
									style: {
										fontFamily: 'ArchivoBlack, Archivo, sans-serif',
										fontSize: '26px',
										letterSpacing: '0.06em',
										textTransform: 'uppercase',
										color: LIME
									},
									children: 'ATS Screener'
								}
							},
							{
								type: 'div',
								props: {
									style: {
										display: 'flex',
										alignItems: 'center',
										gap: '12px',
										padding: '10px 18px',
										border: `1px solid rgba(198, 255, 0, 0.4)`,
										background: 'rgba(198, 255, 0, 0.08)',
										borderRadius: '4px',
										fontFamily: 'JetBrainsMono, monospace',
										fontSize: '17px',
										color: TEXT_SECONDARY,
										letterSpacing: '0.04em'
									},
									children: [
										{
											type: 'div',
											props: {
												style: {
													width: '11px',
													height: '11px',
													borderRadius: '50%',
													background: LIME
												}
											}
										},
										'Start for Free · Real Scores'
									]
								}
							}
						]
					}
				},
				// center: hero headline + score
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							flexDirection: 'column',
							gap: '18px'
						},
						children: [
							// "Your Resume vs. Real ATS Systems" in Archivo Black
							{
								type: 'div',
								props: {
									style: {
										display: 'flex',
										flexDirection: 'column',
										fontFamily: 'ArchivoBlack, Archivo, sans-serif',
										fontSize: '44px',
										lineHeight: 1.12,
										letterSpacing: '-0.02em',
										color: TEXT_PRIMARY
									},
									children: [
										'Your Resume vs.',
										{ type: 'div', props: { style: { color: LIME }, children: 'Real ATS Systems' } }
									]
								}
							},
							// giant score + delta chip
							{
								type: 'div',
								props: {
									style: {
										display: 'flex',
										alignItems: 'baseline',
										gap: '20px'
									},
									children: [
										{
											type: 'div',
											props: {
												style: {
													fontFamily: 'ArchivoBlack, Archivo, sans-serif',
													fontSize: '150px',
													lineHeight: 1,
													letterSpacing: '-0.04em',
													color: LIME
												},
												children: String(score)
											}
										},
										{
											type: 'div',
											props: {
												style: {
													fontSize: '34px',
													fontWeight: 600,
													color: TEXT_SECONDARY
												},
												children: '/100'
											}
										},
										delta !== null && delta > 0
											? {
													type: 'div',
													props: {
														style: {
															display: 'flex',
															alignItems: 'center',
															padding: '8px 18px',
															background: 'rgba(0, 230, 118, 0.16)',
															color: '#00e676',
															borderRadius: '4px',
															fontFamily: 'JetBrainsMono, monospace',
															fontSize: '28px',
															fontWeight: 700
														},
														children: `+${delta}`
													}
												}
											: null,
										delta !== null && delta < 0
											? {
													type: 'div',
													props: {
														style: {
															display: 'flex',
															alignItems: 'center',
															padding: '8px 18px',
															background: 'rgba(255, 82, 82, 0.16)',
															color: '#ff5252',
															borderRadius: '4px',
															fontFamily: 'JetBrainsMono, monospace',
															fontSize: '28px',
															fontWeight: 700
														},
														children: String(delta)
													}
												}
											: null
									].filter(Boolean)
								}
							},
							// tier + pass line
							{
								type: 'div',
								props: {
									style: {
										display: 'flex',
										alignItems: 'center',
										gap: '18px',
										fontFamily: 'JetBrainsMono, monospace'
									},
									children: [
										{
											type: 'div',
											props: {
												style: {
													fontSize: '24px',
													fontWeight: 700,
													color,
													letterSpacing: '0.14em'
												},
												children: label
											}
										},
										{
											type: 'div',
											props: {
												style: { fontSize: '20px', color: TEXT_SECONDARY },
												children: `${pass} of ${total} ATS systems passed`
											}
										}
									]
								}
							}
						]
					}
				},
				// stats strip mirroring the landing hero
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-around',
							padding: '16px 28px',
							background: SURFACE,
							border: `1px solid ${BORDER}`,
							borderRadius: '6px'
						},
						children: [
							{
								type: 'div',
								props: {
									style: {
										display: 'flex',
										flexDirection: 'column',
										alignItems: 'center',
										gap: '2px'
									},
									children: [
										{
											type: 'div',
											props: {
												style: {
													fontFamily: 'ArchivoBlack, Archivo, sans-serif',
													fontSize: '34px',
													color: LIME,
													lineHeight: 1.1
												},
												children: '6'
											}
										},
										{
											type: 'div',
											props: {
												style: {
													fontFamily: 'JetBrainsMono, monospace',
													fontSize: '15px',
													color: TEXT_TERTIARY,
													letterSpacing: '0.08em',
													textTransform: 'uppercase'
												},
												children: 'ATS Platforms'
											}
										}
									]
								}
							},
							{
								type: 'div',
								props: {
									style: { width: '1px', height: '52px', background: BORDER }
								}
							},
							{
								type: 'div',
								props: {
									style: {
										display: 'flex',
										flexDirection: 'column',
										alignItems: 'center',
										gap: '2px'
									},
									children: [
										{
											type: 'div',
											props: {
												style: {
													fontFamily: 'ArchivoBlack, Archivo, sans-serif',
													fontSize: '34px',
													color: CYAN,
													lineHeight: 1.1
												},
												children: `${pass}/${total}`
											}
										},
										{
											type: 'div',
											props: {
												style: {
													fontFamily: 'JetBrainsMono, monospace',
													fontSize: '15px',
													color: TEXT_TERTIARY,
													letterSpacing: '0.08em',
													textTransform: 'uppercase'
												},
												children: 'Systems Passed'
											}
										}
									]
								}
							},
							{
								type: 'div',
								props: {
									style: { width: '1px', height: '52px', background: BORDER }
								}
							},
							{
								type: 'div',
								props: {
									style: {
										display: 'flex',
										flexDirection: 'column',
										alignItems: 'center',
										gap: '2px'
									},
									children: [
										{
											type: 'div',
											props: {
												style: {
													fontFamily: 'ArchivoBlack, Archivo, sans-serif',
													fontSize: '34px',
													color: LIME,
													lineHeight: 1.1
												},
												children: '100%'
											}
										},
										{
											type: 'div',
											props: {
												style: {
													fontFamily: 'JetBrainsMono, monospace',
													fontSize: '15px',
													color: TEXT_TERTIARY,
													letterSpacing: '0.08em',
													textTransform: 'uppercase'
												},
												children: 'Free'
											}
										}
									]
								}
							}
						]
					}
				},
				// footer
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
							gap: '24px',
							fontFamily: 'JetBrainsMono, monospace',
							fontSize: '19px',
							color: TEXT_SECONDARY
						},
						children: [
							{
								type: 'div',
								props: {
									style: { color: TEXT_TERTIARY },
									children: 'Real scores, not made-up numbers'
								}
							},
							{ type: 'div', props: { style: { color: CYAN }, children: url.origin } }
						]
					}
				}
			]
		}
	};

	// @vercel/og's ImageResponse hardcodes Cache-Control: no-cache,no-store and
	// passing a custom Cache-Control via the constructor's headers option only
	// CONCATENATES (verified locally - ends up "no-cache, no-store, public,...").
	// to actually cache at Vercel's CDN we re-wrap the rendered bytes in a fresh
	// Response with the headers we want. since the URL is fully content-addressed
	// (score+pass+total+delta), any unique combination caches forever - massive
	// cost protection because repeat shares of the same link hit the edge cache,
	// never the function
	const og = new ImageResponse(tree as never, {
		width: WIDTH,
		height: HEIGHT,
		fonts: loadFontFaces()
	});
	const buffer = await og.arrayBuffer();

	// store in the function-level memo before responding. LRU eviction keeps
	// the map bounded; oldest entry is at the head of the iterator since Map
	// preserves insertion order and we re-insert on hit above.
	if (renderCache.size >= RENDER_CACHE_MAX) {
		const oldest = renderCache.keys().next().value;
		if (oldest !== undefined) renderCache.delete(oldest);
	}
	renderCache.set(memoKey, buffer);

	return new Response(buffer, {
		status: 200,
		headers: {
			'Content-Type': 'image/png',
			// s-maxage = vercel cdn TTL (1d), max-age = browser TTL (1h),
			// stale-while-revalidate keeps serving stale up to 7d while refreshing
			'Cache-Control':
				'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800, immutable',
			// override the global same-origin CORP set in hooks.server.ts:
			// social platforms (LinkedIn, Twitter, Facebook, Slack) fetch og images
			// from their own origin when generating link previews. same-origin would
			// block those cross-origin fetches and break every social share card.
			// cross-origin is safe here because this endpoint only serves a static
			// pre-rendered PNG with no user-sensitive data.
			'Cross-Origin-Resource-Policy': 'cross-origin'
		}
	});
};
