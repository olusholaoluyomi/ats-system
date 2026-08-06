<script lang="ts">
	import { resumeStore } from '$stores/resume.svelte';
	import { scoresStore } from '$stores/scores.svelte';
	import { buildImprovedResume } from '$engine/export/improve-resume';
	import { downloadCvDocx, downloadCvPdf } from '$engine/export/download-cv';
	import { logger } from '$lib/log';

	// editable preview of the improved CV; regenerated from the original parsed
	// text whenever a new scan lands so re-scans start from the source resume
	let improvedText = $state('');
	let appliedNotes = $state<string[]>([]);
	let isExporting = $state(false);

	const baseFileName = $derived.by(() => {
		const name = resumeStore.file?.name ?? 'resume';
		return name.replace(/\.[^.]+$/, '') || 'resume';
	});

	function regenerate() {
		const resume = resumeStore.resume;
		if (!resume) return;
		const result = buildImprovedResume(resume.rawText, resume, scoresStore.results);
		improvedText = result.text;
		appliedNotes = result.applied;
	}

	$effect(() => {
		if (resumeStore.isReady && scoresStore.hasResults) {
			regenerate();
		}
	});

	async function handleDocx() {
		if (!improvedText.trim() || isExporting) return;
		isExporting = true;
		try {
			await downloadCvDocx(improvedText, `${baseFileName}-improved.docx`);
		} catch (err) {
			logger.error('cv.docx_export_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
		} finally {
			isExporting = false;
		}
	}

	async function handlePdf() {
		if (!improvedText.trim() || isExporting) return;
		isExporting = true;
		try {
			await downloadCvPdf(improvedText, `${baseFileName}-improved.pdf`);
		} catch (err) {
			logger.error('cv.pdf_export_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
		} finally {
			isExporting = false;
		}
	}
</script>

{#if resumeStore.isReady && scoresStore.hasResults}
	<section class="updated-resume">
		<div class="ur-header">
			<svg
				class="ur-icon"
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14,2 14,8 20,8" />
				<line x1="12" y1="18" x2="12" y2="12" />
				<polyline points="9,15 12,18 15,15" />
			</svg>
			<div>
				<h3 class="ur-title">Updated Resume</h3>
				<p class="ur-subtitle">
					Your upload with the detected improvements applied. Edit below, then download as
					DOCX or PDF and re-scan.
				</p>
			</div>
		</div>

		{#if appliedNotes.length > 0}
			<div class="ur-improvements">
				{#each appliedNotes as note, i (note + i)}
					<div class="ur-note">
						<svg
							width="13"
							height="13"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
						>
							<polyline points="20,6 9,17 4,12" />
						</svg>
						<span>{note}</span>
					</div>
				{/each}
			</div>
		{:else}
			<p class="ur-no-changes">No keyword changes to apply — your resume already covers what was detected.</p>
		{/if}

		<textarea
			class="ur-textarea"
			bind:value={improvedText}
			rows="16"
			spellcheck="false"
			aria-label="Updated resume text, editable before download"
		></textarea>

		<div class="ur-actions">
			<button
				type="button"
				class="ur-btn primary"
				onclick={handleDocx}
				disabled={isExporting || improvedText.trim().length === 0}
			>
				{#if isExporting}
					<span class="ur-spinner"></span>
				{/if}
				Download .docx
			</button>
			<button
				type="button"
				class="ur-btn"
				onclick={handlePdf}
				disabled={isExporting || improvedText.trim().length === 0}
			>
				Download .pdf
			</button>
			<button type="button" class="ur-btn" onclick={regenerate} disabled={isExporting}>
				Reset edits
			</button>
		</div>
	</section>
{/if}

<style>
	.updated-resume {
		padding: 1.75rem;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
		backdrop-filter: blur(var(--glass-blur));
	}

	.ur-header {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}

	.ur-icon {
		flex-shrink: 0;
		color: var(--accent-text);
		margin-top: 2px;
	}

	.ur-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.ur-subtitle {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		margin: 0.25rem 0 0;
		line-height: 1.5;
	}

	.ur-improvements {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 1rem;
	}

	.ur-note {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.82rem;
		color: #22c55e;
		padding: 0.45rem 0.75rem;
		background: rgba(34, 197, 94, 0.06);
		border: 1px solid rgba(34, 197, 94, 0.18);
		border-radius: var(--radius-md);
	}

	.ur-note svg {
		flex-shrink: 0;
	}

	.ur-no-changes {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		margin: 0 0 1rem;
		padding: 0.6rem 0.85rem;
		background: var(--tint-weak);
		border: 1px solid var(--tint);
		border-radius: var(--radius-md);
	}

	.ur-textarea {
		width: 100%;
		min-height: 320px;
		padding: 0.9rem 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-family: var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace);
		font-size: 0.82rem;
		line-height: 1.55;
		resize: vertical;
		outline: none;
	}

	.ur-textarea:focus-visible {
		border-color: var(--accent-border-hover);
		box-shadow: 0 0 0 2px var(--accent-tint);
	}

	.ur-textarea::placeholder {
		color: var(--text-tertiary);
		opacity: 0.7;
	}

	.ur-actions {
		display: flex;
		gap: 0.6rem;
		margin-top: 1rem;
		flex-wrap: wrap;
	}

	.ur-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.6rem 1.15rem;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		font-size: 0.85rem;
		font-weight: 600;
		font-family: inherit;
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			border-color 0.2s ease,
			color 0.2s ease,
			background 0.2s ease;
	}

	.ur-btn:hover:not(:disabled) {
		border-color: var(--accent-border-hover);
		color: var(--accent-text);
		background: var(--accent-tint);
	}

	.ur-btn.primary {
		color: var(--btn-text);
		background: var(--gradient-primary);
		border-color: transparent;
	}

	.ur-btn.primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.ur-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.ur-spinner {
		width: 13px;
		height: 13px;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		border-radius: 50%;
		animation: ur-spin 0.6s linear infinite;
	}

	@keyframes ur-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 640px) {
		.updated-resume {
			padding: 1.25rem;
		}

		.ur-actions {
			flex-direction: column;
		}

		.ur-btn {
			justify-content: center;
			min-height: 44px;
		}
	}
</style>
