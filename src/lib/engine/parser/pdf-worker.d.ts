// the pdf.js worker entry point ships without types. only its
// WorkerMessageHandler export is used (by pdf-parser's iOS main-thread
// fallback, which exposes the module as globalThis.pdfjsWorker so pdf.js
// skips creating a real Web Worker).
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs' {
	export const WorkerMessageHandler: unknown;
}
