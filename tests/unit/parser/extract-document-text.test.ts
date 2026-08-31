import { describe, it, expect } from 'vitest';
import { extractDocumentText } from '$engine/parser';

// extractDocumentText reuses the same PDF/DOCX text-extraction layer as
// parseResume for documents that only need their raw text (uploaded JD files).
// the success path depends on pdfjs/mammoth actually parsing real documents,
// so like the rest of the parser suite we test the deterministic error paths
// here and leave binary parsing to manual/e2e verification.
describe('extractDocumentText', () => {
	it('rejects unsupported MIME types with the same message as parseResume', async () => {
		const file = new File(['hello'], 'jd.txt', { type: 'text/plain' });
		const result = await extractDocumentText(file);
		expect(result.success).toBe(false);
		expect(result.text).toBe('');
		expect(result.error).toBe('unsupported file type: text/plain');
	});

	it('falls back to the file extension when the MIME type is empty', async () => {
		const file = new File(['hello'], 'jd.xyz', { type: '' });
		const result = await extractDocumentText(file);
		expect(result.success).toBe(false);
		expect(result.error).toBe('unsupported file type: xyz');
	});

	it('returns a per-format error for a corrupt PDF', async () => {
		const file = new File(['this is definitely not a valid pdf'], 'jd.pdf', {
			type: 'application/pdf'
		});
		const result = await extractDocumentText(file);
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/^failed to parse PDF:/);
	}, 15_000); // pdfjs can be slow to reject corrupt input in jsdom — give it headroom
});
