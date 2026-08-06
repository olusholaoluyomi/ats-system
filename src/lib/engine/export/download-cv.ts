// client-side CV export. builds a .docx via the `docx` package or a .pdf via
// jsPDF (same library the results report uses) from plain resume text. both
// generators are dynamic imports so their weight only loads on first download.

function triggerDownload(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isHeading(line: string): boolean {
	const t = line.trim();
	if (!t || t.length > 60) return false;
	const cleaned = t.replace(/[:\-_|]/g, '').trim();
	const knownHeader = /^(skills|technical skills|experience|work experience|education|summary|profile|objective|projects|contact|certifications|awards|languages)$/i.test(
		cleaned
	);
	const allCapsShort = cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned) && t.split(/\s+/).length <= 5;
	return knownHeader || allCapsShort;
}

function isBullet(line: string): boolean {
	return /^[-•*]\s/.test(line.trim());
}

function toDocxParagraphs(text: string) {
	// types import keeps the heavy `docx` module out of the static bundle
	return text.split(/\r?\n/).map((rawLine) => {
		const line = rawLine.trim();
		if (!line) {
			return { kind: 'blank' as const };
		}
		if (isHeading(line)) {
			return { kind: 'heading' as const, text: line };
		}
		if (isBullet(line)) {
			return { kind: 'bullet' as const, text: line };
		}
		return { kind: 'text' as const, text: line };
	});
}

export async function downloadCvDocx(text: string, fileName: string): Promise<void> {
	const { Document, Packer, Paragraph, TextRun } = await import('docx');
	const paragraphs = toDocxParagraphs(text).map((p) => {
		if (p.kind === 'blank') return new Paragraph({ text: '' });
		if (p.kind === 'heading') {
			return new Paragraph({
				children: [new TextRun({ text: p.text, bold: true })],
				spacing: { before: 240, after: 120 }
			});
		}
		if (p.kind === 'bullet') {
			return new Paragraph({
				children: [new TextRun({ text: p.text })],
				bullet: { level: 0 }
			});
		}
		return new Paragraph({ children: [new TextRun({ text: p.text })] });
	});
	const doc = new Document({
		sections: [{ children: paragraphs }]
	});
	const blob = await Packer.toBlob(doc);
	triggerDownload(blob, fileName);
}

export async function downloadCvPdf(text: string, fileName: string): Promise<void> {
	const { jsPDF } = await import('jspdf');
	const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
	const margin = 54;
	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const maxWidth = pageWidth - margin * 2;
	const maxY = pageHeight - margin;
	let y = margin;

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(11);

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) {
			y += 12;
			continue;
		}
		const heading = isHeading(line);
		doc.setFont('helvetica', heading ? 'bold' : 'normal');
		doc.setFontSize(heading ? 13 : 11);
		const wrapped = doc.splitTextToSize(line, maxWidth) as string[];
		for (const wrappedLine of wrapped) {
			if (y > maxY) {
				doc.addPage();
				y = margin;
			}
			doc.text(wrappedLine, margin, y);
			y += heading ? 20 : 15;
		}
	}
	doc.save(fileName);
}
