import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parsePDF } from '$engine/parser/pdf-parser';

// regression test for the Safari PDF-parsing outage. the modern pdfjs-dist
// build requires Promise.withResolvers (Safari <17.4 / Chrome <119 /
// Firefox <121 throw "undefined is not a function"), so pdf-parser imports
// the legacy build which polyfills it at module load. these tests pin both
// halves of that contract: the polyfill actually restoring the API on load,
// and the legacy build parsing a real PDF buffer end to end.

// minimal single-page PDF with a text stream, generated with correct
// xref byte offsets so pdfjs can open it without repair.
function makeMinimalPDF(text: string): Uint8Array<ArrayBuffer> {
	const streamContent = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${Buffer.byteLength(streamContent, 'latin1')} >>\nstream\n${streamContent}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];

	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	for (const [i, obj] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf, 'latin1'));
		pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
	}
	const xrefStart = Buffer.byteLength(pdf, 'latin1');
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const off of offsets) {
		pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
	return new TextEncoder().encode(pdf) as Uint8Array<ArrayBuffer>;
}

// pdf-parser sets workerSrc to an http:// URL (fine in a browser, where the
// fake-worker fallback fetches it over the network), but Node's ESM loader
// only imports file/data URLs. point it at the real file on disk so the
// fake-worker setup can dynamic-import it under vitest.
const LEGACY_WORKER_URL = pathToFileURL(
	resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')
).toString();

describe('pdfjs legacy build compatibility', () => {
	it('polyfills Promise.withResolvers at module load (old-browser support)', async () => {
		// simulate a pre-Safari-17.4 browser: the API the modern build needs
		// is missing, and importing the legacy build must restore it.
		const original = Promise.withResolvers;
		try {
			// @ts-expect-error simulating the absence of the API on old engines
			Promise.withResolvers = undefined;
			expect(Promise.withResolvers).toBeUndefined();

			// drop the module cache so the import re-evaluates the legacy build
			// from scratch and its top-level polyfill actually runs. the query
			// string keys a distinct ESM module, sidestepping both vite's
			// registry and Node's native module cache.
			vi.resetModules();
			// @ts-expect-error cache-busting query keyed a distinct ESM module; the
			// runtime resolves it, TS's static resolver does not
			await import('pdfjs-dist/legacy/build/pdf.mjs?polyfill-regression=1');

			expect(typeof Promise.withResolvers).toBe('function');
			const { promise, resolve, reject } = Promise.withResolvers();
			expect(typeof promise.then).toBe('function');
			expect(typeof resolve).toBe('function');
			expect(typeof reject).toBe('function');
		} finally {
			Promise.withResolvers = original;
		}
	});

	it('parses a real PDF buffer through parsePDF', async () => {
		// jsdom has no Worker, so pdfjs goes down the fake-worker path, which
		// dynamic-imports workerSrc. override it to the on-disk worker file.
		pdfjsLib.GlobalWorkerOptions.workerSrc = LEGACY_WORKER_URL;

		const bytes = makeMinimalPDF('Hello ATS parser');
		const file = new File([bytes], 'resume.pdf', { type: 'application/pdf' });

		const result = await parsePDF(file);

		expect(result.pageCount).toBe(1);
		expect(result.text).toContain('Hello ATS parser');
		expect(result.hasMultipleColumns).toBe(false);
		expect(result.hasTables).toBe(false);
		expect(result.hasImages).toBe(false);
	});
});
