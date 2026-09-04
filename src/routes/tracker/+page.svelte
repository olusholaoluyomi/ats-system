<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$stores/auth.svelte';
	import {
		applicationsStore,
		type ApplicationStatus,
		type TrackedApplication
	} from '$stores/applications.svelte';
	import SeoHead from '$components/seo/SeoHead.svelte';

	const STATUSES: { value: ApplicationStatus; label: string }[] = [
		{ value: 'saved', label: 'Saved' },
		{ value: 'applied', label: 'Applied' },
		{ value: 'interviewing', label: 'Interviewing' },
		{ value: 'offer', label: 'Offer' },
		{ value: 'rejected', label: 'Rejected' },
		{ value: 'withdrawn', label: 'Withdrawn' }
	];

	let activeFilter = $state<ApplicationStatus | 'all'>('all');
	let showAddForm = $state(false);
	let formCompany = $state('');
	let formTitle = $state('');
	let formUrl = $state('');
	let formNotes = $state('');
	let formStatus = $state<ApplicationStatus>('applied');
	let submittingManual = $state(false);
	// per-row pending notes draft, keyed by application id - lets the
	// textarea save on blur without fighting the store's own value on every
	// keystroke
	let notesDrafts = $state<Record<string, string>>({});

	// redirect if not logged in. self-host installs (auth disabled) skip the
	// redirect: the tracker is localStorage-backed and viewable without a
	// sign-in, same as /history.
	$effect(() => {
		if (authStore.disabled) return;
		if (!authStore.loading && !authStore.isAuthenticated) {
			goto('/login');
		}
	});

	$effect(() => {
		if (authStore.disabled || authStore.isAuthenticated) {
			applicationsStore.load();
		}
	});

	const filtered = $derived(
		activeFilter === 'all'
			? applicationsStore.list
			: applicationsStore.list.filter((a) => a.status === activeFilter)
	);

	function statusLabel(status: ApplicationStatus): string {
		return STATUSES.find((s) => s.value === status)?.label ?? status;
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function draftFor(entry: TrackedApplication): string {
		return notesDrafts[entry.id] ?? entry.notes;
	}

	function saveNotes(entry: TrackedApplication) {
		const draft = notesDrafts[entry.id];
		if (draft === undefined || draft === entry.notes) return;
		applicationsStore.updateNotes(entry.id, draft);
	}

	async function handleAddManual(e: Event) {
		e.preventDefault();
		const companyName = formCompany.trim();
		const title = formTitle.trim();
		if (!companyName || !title) return;

		submittingManual = true;
		try {
			await applicationsStore.addManual({
				companyName,
				title,
				applyUrl: formUrl,
				notes: formNotes,
				status: formStatus
			});
			formCompany = '';
			formTitle = '';
			formUrl = '';
			formNotes = '';
			formStatus = 'applied';
			showAddForm = false;
		} finally {
			submittingManual = false;
		}
	}
</script>

<SeoHead
	title="Application Tracker | ATS Screener"
	description="Track every job you've applied to - status, notes, and dates in one place."
/>

<main class="tracker-page">
	<header class="tracker-header">
		<h1 class="tracker-title">Application Tracker</h1>
		<p class="tracker-subtitle">
			Every job you've saved or applied to, in one place. Update status as things move.
		</p>
	</header>

	<div class="tracker-toolbar">
		<div class="filter-chips">
			<button
				class="filter-chip"
				class:active={activeFilter === 'all'}
				onclick={() => (activeFilter = 'all')}
			>
				All
			</button>
			{#each STATUSES as s (s.value)}
				<button
					class="filter-chip"
					class:active={activeFilter === s.value}
					onclick={() => (activeFilter = s.value)}
				>
					{s.label}
				</button>
			{/each}
		</div>
		<button class="btn-secondary" onclick={() => (showAddForm = !showAddForm)}>
			{showAddForm ? 'Cancel' : 'Add manual entry'}
		</button>
	</div>

	{#if showAddForm}
		<form class="add-form" onsubmit={handleAddManual}>
			<div class="form-row">
				<label class="field">
					<span class="field-label">Company</span>
					<input
						type="text"
						bind:value={formCompany}
						placeholder="Company name"
						required
						class="field-input"
					/>
				</label>
				<label class="field">
					<span class="field-label">Title</span>
					<input
						type="text"
						bind:value={formTitle}
						placeholder="Job title"
						required
						class="field-input"
					/>
				</label>
			</div>
			<div class="form-row">
				<label class="field">
					<span class="field-label">Job URL (optional)</span>
					<input type="url" bind:value={formUrl} placeholder="https://..." class="field-input" />
				</label>
				<label class="field">
					<span class="field-label">Status</span>
					<select bind:value={formStatus} class="field-input">
						{#each STATUSES as s (s.value)}
							<option value={s.value}>{s.label}</option>
						{/each}
					</select>
				</label>
			</div>
			<label class="field">
				<span class="field-label">Notes (optional)</span>
				<textarea
					bind:value={formNotes}
					placeholder="Anything worth remembering about this one"
					rows="2"
					class="field-input"></textarea>
			</label>
			<button type="submit" class="btn-primary" disabled={submittingManual}>
				{#if submittingManual}
					<span class="spinner"></span>
				{/if}
				Add to Tracker
			</button>
		</form>
	{/if}

	{#if applicationsStore.loading}
		<p class="tracker-empty">Loading...</p>
	{:else if filtered.length === 0}
		<p class="tracker-empty">
			{#if activeFilter === 'all'}
				Nothing tracked yet. Save a role from the <a href="/jobs">job board</a> or add one manually.
			{:else}
				No applications with this status.
			{/if}
		</p>
	{:else}
		<div class="tracker-list">
			{#each filtered as entry (entry.id)}
				<div class="tracker-row">
					<div class="row-main">
						<div class="row-top">
							<span class="row-company">{entry.companyName}</span>
							<span class="status-badge status-{entry.status}">{statusLabel(entry.status)}</span>
							{#if entry.source === 'board'}
								<span class="source-chip">From job board</span>
							{/if}
						</div>
						{#if entry.applyUrl}
							<a class="row-title" href={entry.applyUrl} target="_blank" rel="noopener noreferrer">
								{entry.title}
							</a>
						{:else}
							<span class="row-title">{entry.title}</span>
						{/if}
						<div class="row-dates">
							<span>Saved {formatDate(entry.createdAt)}</span>
							{#if entry.appliedAt}
								<span>· Applied {formatDate(entry.appliedAt)}</span>
							{/if}
						</div>
					</div>

					<div class="row-controls">
						<select
							class="status-select"
							value={entry.status}
							onchange={(e) =>
								applicationsStore.updateStatus(
									entry.id,
									e.currentTarget.value as ApplicationStatus
								)}
							aria-label="Status for {entry.title} at {entry.companyName}"
						>
							{#each STATUSES as s (s.value)}
								<option value={s.value}>{s.label}</option>
							{/each}
						</select>
						<button
							class="remove-btn"
							onclick={() => applicationsStore.remove(entry.id)}
							aria-label="Remove {entry.title} at {entry.companyName}"
						>
							Remove
						</button>
					</div>

					<textarea
						class="notes-input"
						value={draftFor(entry)}
						oninput={(e) => (notesDrafts[entry.id] = e.currentTarget.value)}
						onblur={() => saveNotes(entry)}
						placeholder="Notes..."
						rows="1"
						aria-label="Notes for {entry.title} at {entry.companyName}"></textarea>
				</div>
			{/each}
		</div>
	{/if}
</main>

<style>
	.tracker-page {
		max-width: var(--container-md);
		margin: 0 auto;
		padding: var(--space-12) var(--space-6) var(--space-24);
	}

	.tracker-header {
		text-align: center;
		margin-bottom: var(--space-8);
	}

	.tracker-title {
		font-size: var(--text-3xl);
		font-weight: 800;
		color: var(--text-primary);
		margin-bottom: var(--space-3);
	}

	.tracker-subtitle {
		color: var(--text-secondary);
	}

	.tracker-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-6);
	}

	.filter-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.filter-chip {
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-full);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		color: var(--text-secondary);
		font-size: var(--text-xs);
		cursor: pointer;
		font-family: inherit;
	}

	.filter-chip.active {
		background: var(--accent-tint);
		border-color: var(--accent-border);
		color: var(--accent-text);
	}

	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-5);
		border-radius: var(--radius-full);
		font-weight: 600;
		font-size: var(--text-sm);
		text-decoration: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
	}

	.btn-primary {
		background: var(--gradient-primary);
		color: var(--btn-text, #0a0e14);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		color: var(--text-primary);
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(0, 0, 0, 0.2);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.add-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
		margin-bottom: var(--space-6);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-label {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.field-input {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		color: var(--text-primary);
		font-family: inherit;
	}

	.tracker-empty {
		text-align: center;
		color: var(--text-secondary);
		padding: var(--space-16) 0;
	}

	.tracker-empty a {
		color: var(--accent-text);
	}

	.tracker-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.tracker-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-3) var(--space-4);
		padding: var(--space-5);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
	}

	.row-main {
		min-width: 0;
	}

	.row-top {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
	}

	.row-company {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.source-chip {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		padding: 0 var(--space-2);
		border-left: 1px solid var(--glass-border);
	}

	.status-badge {
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 0 var(--space-2);
		border-radius: var(--radius-full);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		color: var(--text-secondary);
	}

	.status-badge.status-offer {
		background: rgba(0, 230, 118, 0.09);
		border-color: rgba(0, 230, 118, 0.28);
		color: var(--accent-green);
	}

	.status-badge.status-rejected,
	.status-badge.status-withdrawn {
		background: rgba(239, 68, 68, 0.08);
		border-color: rgba(239, 68, 68, 0.2);
		color: #ef4444;
	}

	.status-badge.status-interviewing {
		background: var(--accent-tint);
		border-color: var(--accent-border);
		color: var(--accent-text);
	}

	.row-title {
		display: block;
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--text-primary);
		text-decoration: none;
		margin-bottom: var(--space-1);
	}

	a.row-title:hover {
		color: var(--accent-text);
	}

	.row-dates {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		display: flex;
		gap: var(--space-1);
	}

	.row-controls {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-2);
	}

	.status-select {
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-md);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		color: var(--text-primary);
		font-size: var(--text-sm);
		font-family: inherit;
	}

	.remove-btn {
		background: none;
		border: none;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		cursor: pointer;
		padding: 0;
		font-family: inherit;
	}

	.remove-btn:hover {
		color: #ef4444;
	}

	.notes-input {
		grid-column: 1 / -1;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		color: var(--text-primary);
		font-family: inherit;
		resize: vertical;
	}

	@media (max-width: 640px) {
		.tracker-row {
			grid-template-columns: 1fr;
		}

		.row-controls {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}

		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
