// use the legacy build (not the default modern one). the modern pdfjs-dist
// build requires APIs like Promise.withResolvers that only shipped in
// Safari 17.4 / Chrome 119 / Firefox 121; the legacy build ships a polyfill
// for them at module load, so resume parsing keeps working for users on
// older browsers instead of failing with "undefined is not a function".
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
	'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
	import.meta.url
).toString();

interface PDFTextLine {
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	pageIndex: number;
}

interface PDFParseResult {
	text: string;
	lines: string[];
	pageCount: number;
	hasMultipleColumns: boolean;
	hasTables: boolean;
	hasImages: boolean;
}

// iOS Safari's ES-module Web Worker support is unreliable — even on recent
// iOS builds a pdf.js worker can fail its startup handshake and then
// getDocument() hangs forever instead of rejecting (no error is ever thrown,
// so try/catch and error banners never fire). bypass the worker on iOS and
// parse on the main thread instead: pdf.js v5+ treats
// globalThis.pdfjsWorker.WorkerMessageHandler as the main-thread "fake
// worker" and skips creating a real Worker when it's present.
let mainThreadWorkerPromise: Promise<void> | null = null;
function forceMainThreadWorker(): Promise<void> {
	if ((globalThis as any).pdfjsWorker?.WorkerMessageHandler) {
		return Promise.resolve();
	}
	mainThreadWorkerPromise ??= import('pdfjs-dist/legacy/build/pdf.worker.min.mjs').then((mod) => {
		(globalThis as any).pdfjsWorker = mod;
	});
	return mainThreadWorkerPromise;
}

function isIOSBrowser(): boolean {
	return typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

// reads a File's bytes via the modern arrayBuffer API when present, falling
// back to FileReader.readAsArrayBuffer on older iOS/Safari/WebViews that lack
// (or have buggy) Blob.arrayBuffer implementations.
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
	if (typeof (file as any).arrayBuffer === 'function') {
		return file.arrayBuffer();
	}
	return new Promise<ArrayBuffer>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as ArrayBuffer);
		reader.onerror = () => reject(reader.error);
		reader.readAsArrayBuffer(file);
	});
}

// a stalled pdf.js worker (or a pathological document) hangs instead of
// rejecting, which would leave the scanner spinning forever. bound every
// worker round-trip with a timeout so the caller gets a real error and can
// destroy the loading task.
function withTimeout<T>(promise: Promise<T>, ms: number, phase: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${phase} timed out after ${ms / 1000}s`)), ms);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			}
		);
	});
}

// extracts text from a PDF with layout-aware line reconstruction. pdf.js runs
// in a Web Worker on desktop browsers; on iOS it is forced onto the main
// thread (see forceMainThreadWorker) because iOS Safari's module-worker
// support is what breaks parsing there.
export async function parsePDF(file: File): Promise<PDFParseResult> {
	if (isIOSBrowser()) {
		await forceMainThreadWorker();
	}

	const buffer = await readFileAsArrayBuffer(file);

	// keep the loading task so a timeout/failure can destroy it (which
	// terminates a stalled worker instead of leaking it).
	const loadingTask = pdfjsLib.getDocument({ data: buffer });

	try {
		const pdf = await withTimeout(loadingTask.promise, 30_000, 'opening the document');
		const pageCount = pdf.numPages;

		const allLines: PDFTextLine[] = [];
		let hasImages = false;

		for (let i = 1; i <= pageCount; i++) {
			const page = await withTimeout(pdf.getPage(i), 30_000, `loading page ${i}`);
			const textContent = await withTimeout(
				page.getTextContent(),
				30_000,
				`extracting text from page ${i}`
			);
			const operators = await withTimeout(
				page.getOperatorList(),
				30_000,
				`reading operators on page ${i}`
			);

			// detect actual raster images via operator list
			// only count paintImageXObject (real images), NOT paintXObject (which includes fonts/glyphs)
			// LaTeX PDFs embed glyphs as XObjects, causing false positives with paintXObject
			const imageOps = [pdfjsLib.OPS.paintImageXObject, pdfjsLib.OPS.paintImageMaskXObject];
			for (let opIdx = 0; opIdx < operators.fnArray.length; opIdx++) {
				if (imageOps.includes(operators.fnArray[opIdx])) {
					// check if the image is large enough to be a real image (not a tiny glyph/icon)
					// small images (<50px in either dimension) are likely font glyphs or bullets
					const args = operators.argsArray[opIdx];
					if (args && args[0]) {
						try {
							const imgObj = page.objs.get(args[0] as string) as {
								width?: number;
								height?: number;
							} | null;
							if (imgObj && (imgObj.width ?? 0) > 50 && (imgObj.height ?? 0) > 50) {
								hasImages = true;
								break;
							}
						} catch {
							// if we can't inspect the image object, count it conservatively
							hasImages = true;
							break;
						}
					}
				}
			}

			for (const item of textContent.items) {
				if (!('str' in item)) continue;
				const textItem = item as TextItem;
				if (!textItem.str.trim()) continue;

				allLines.push({
					text: textItem.str,
					x: textItem.transform[4],
					y: textItem.transform[5],
					width: textItem.width,
					height: textItem.height,
					pageIndex: i - 1
				});
			}
		}

		const hasMultipleColumns = detectMultipleColumns(allLines);
		const hasTables = detectTables(allLines);

		// group text items into lines by y-position proximity
		const reconstructedLines = reconstructLines(allLines);
		const text = reconstructedLines.join('\n');

		return {
			text,
			lines: reconstructedLines,
			pageCount,
			hasMultipleColumns,
			hasTables,
			hasImages
		};
	} catch (err) {
		// tear down the loading task so a timed-out/stalled worker is
		// terminated rather than left running in the background
		await loadingTask.destroy().catch(() => {});
		throw err;
	}
}

// groups text items into lines by y-position (3px threshold), sorted top-to-bottom
function reconstructLines(items: PDFTextLine[]): string[] {
	if (items.length === 0) return [];

	// sort by page, then by y (descending = top first), then by x
	const sorted = [...items].sort((a, b) => {
		if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
		if (Math.abs(a.y - b.y) > 3) return b.y - a.y;
		return a.x - b.x;
	});

	const lines: string[] = [];
	let currentLine: PDFTextLine[] = [sorted[0]];

	for (let i = 1; i < sorted.length; i++) {
		const item = sorted[i];
		const prev = currentLine[currentLine.length - 1];

		const samePage = item.pageIndex === prev.pageIndex;
		const sameLine = Math.abs(item.y - prev.y) <= 3;

		if (samePage && sameLine) {
			currentLine.push(item);
		} else {
			lines.push(mergeLine(currentLine));
			currentLine = [item];
		}
	}

	if (currentLine.length > 0) {
		lines.push(mergeLine(currentLine));
	}

	return lines.filter((line) => line.trim().length > 0);
}

// merges text items on the same line, inserting spaces at significant gaps
function mergeLine(items: PDFTextLine[]): string {
	if (items.length === 0) return '';
	if (items.length === 1) return items[0].text;

	const sorted = [...items].sort((a, b) => a.x - b.x);
	let result = sorted[0].text;

	for (let i = 1; i < sorted.length; i++) {
		const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width);
		// insert space if gap is larger than ~half a character width
		const charWidth = sorted[i].height * 0.5;
		if (gap > charWidth) {
			result += ' ';
		}
		result += sorted[i].text;
	}

	return result;
}

// detects multi-column layouts by checking for distinct x-position clusters
function detectMultipleColumns(items: PDFTextLine[]): boolean {
	if (items.length < 20) return false;

	const xPositions = items.map((item) => Math.round(item.x / 10) * 10);
	const xCounts = new Map<number, number>();

	for (const x of xPositions) {
		xCounts.set(x, (xCounts.get(x) || 0) + 1);
	}

	// find distinct x-clusters with significant item counts
	const significantClusters = [...xCounts.entries()]
		.filter(([_, count]) => count > items.length * 0.05)
		.map(([x]) => x)
		.sort((a, b) => a - b);

	if (significantClusters.length < 2) return false;

	// check if clusters are far enough apart to be separate columns
	for (let i = 1; i < significantClusters.length; i++) {
		const gap = significantClusters[i] - significantClusters[i - 1];
		if (gap > 150) return true;
	}

	return false;
}

// detects table-like structures by looking for aligned columns with consistent gaps
function detectTables(items: PDFTextLine[]): boolean {
	if (items.length < 10) return false;

	// group items by y-position (same line)
	const lineGroups = new Map<number, PDFTextLine[]>();
	for (const item of items) {
		const roundedY = Math.round(item.y / 3) * 3;
		if (!lineGroups.has(roundedY)) {
			lineGroups.set(roundedY, []);
		}
		lineGroups.get(roundedY)!.push(item);
	}

	// count lines with 3+ separate text items (potential table rows)
	let tableRowCount = 0;
	for (const [, lineItems] of lineGroups) {
		if (lineItems.length >= 3) {
			const sorted = lineItems.sort((a, b) => a.x - b.x);
			const gaps = [];
			for (let i = 1; i < sorted.length; i++) {
				gaps.push(sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width));
			}
			// if there are large, consistent gaps, it looks like a table
			const largeGaps = gaps.filter((g) => g > 30);
			if (largeGaps.length >= 2) tableRowCount++;
		}
	}

	return tableRowCount >= 3;
}
