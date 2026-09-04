<script lang="ts">
	import SeoHead from '$components/seo/SeoHead.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { applicationsStore, type ApplicationStatus } from '$stores/applications.svelte';
	import { incrementApplyClick } from '$lib/job-analytics';
	import {
		timeAgo,
		formatPostedDate,
		formatDescription,
		workModeLabel,
		experienceLabel
	} from '../shared';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const job = $derived(data.job);
	const descriptionBlocks = $derived(formatDescription(job.descriptionText));

	const STATUSES: { value: ApplicationStatus; label: string }[] = [
		{ value: 'saved', label: 'Saved' },
		{ value: 'applied', label: 'Applied' },
		{ value: 'interviewing', label: 'Interviewing' },
		{ value: 'offer', label: 'Offer' },
		{ value: 'rejected', label: 'Rejected' },
		{ value: 'withdrawn', label: 'Withdrawn' }
	];

	// applicationsStore.list is empty until loaded; load once so "already
	// tracked?" resolves correctly on a fresh page visit (a user landing here
	// straight from a search result, not via /tracker).
	$effect(() => {
		if (authStore.disabled || authStore.isAuthenticated) {
			applicationsStore.load();
		}
	});

	const trackedEntry = $derived(applicationsStore.list.find((a) => a.id === job.id));
	let saving = $state(false);

	async function handleSave() {
		saving = true;
		try {
			await applicationsStore.addFromBoard(job);
		} finally {
			saving = false;
		}
	}
</script>

<SeoHead
	title="{job.title} at {job.companyName} | ATS Screener Job Board"
	description="{job.title} at {job.companyName} - {job.locationRaw ||
		'remote'}. Check your ATS score against this role before you apply."
	noIndex={!job.active}
/>

<main class="job-detail">
	<a href="/jobs" class="back-link">← Back to job board</a>

	{#if !job.active}
		<div class="stale-banner">
			This role may no longer be accepting applications - it hasn't appeared in the source company's
			board on our last check.
		</div>
	{/if}

	<header class="job-detail-header">
		<span class="job-company">{job.companyName}</span>
		<h1 class="job-title">{job.title}</h1>
		<p class="job-location">{job.locationRaw || 'Location not specified'}</p>
		<p class="job-posted-date">
			Date posted: {formatPostedDate(job.firstSeenAt)} ({timeAgo(job.firstSeenAt)})
		</p>

		<div class="job-chips">
			<span class="meta-chip chip-{job.workMode}">{workModeLabel(job.workMode)}</span>
			{#if experienceLabel(job)}
				<span class="meta-chip chip-experience">{experienceLabel(job)}</span>
			{/if}
			{#if job.compensationText}
				<span class="meta-chip chip-compensation">{job.compensationText}</span>
			{/if}
			{#if job.relocationSupport}
				<span class="meta-chip chip-relocation">Relocation support</span>
			{/if}
		</div>

		{#if job.whyThisCompany}
			<p class="job-why">{job.whyThisCompany}</p>
		{/if}

		<div class="job-actions">
			<a
				class="btn-primary"
				href={job.applyUrl}
				target="_blank"
				rel="noopener noreferrer"
				onclick={() => incrementApplyClick(job.id)}
			>
				Apply on {job.companyName}'s site
			</a>
			<a class="btn-secondary" href="/scanner?jobId={job.id}">Check my CV Score first</a>
			{#if authStore.disabled || authStore.isAuthenticated}
				{#if trackedEntry}
					<select
						class="tracker-select"
						value={trackedEntry.status}
						onchange={(e) =>
							applicationsStore.updateStatus(
								trackedEntry.id,
								e.currentTarget.value as ApplicationStatus
							)}
						aria-label="Tracker status for this job"
					>
						{#each STATUSES as s (s.value)}
							<option value={s.value}>{s.label}</option>
						{/each}
					</select>
				{:else}
					<button class="btn-secondary" onclick={handleSave} disabled={saving}>
						{saving ? 'Saving...' : 'Save to Tracker'}
					</button>
				{/if}
			{:else}
				<a class="btn-secondary" href="/login">Sign in to track this job</a>
			{/if}
		</div>
	</header>

	<section class="job-description">
		<h2>Full description</h2>
		{#if descriptionBlocks.length === 0}
			<p class="job-description-text">No description available.</p>
		{:else}
			{#each descriptionBlocks as block, i (i)}
				{#if block.type === 'bullets'}
					<ul class="job-description-list">
						{#each block.lines as line, j (j)}
							<li>{line}</li>
						{/each}
					</ul>
				{:else}
					<p class="job-description-text">
						{#each block.lines as line, j (j)}
							{line}{#if j < block.lines.length - 1}<br />{/if}
						{/each}
					</p>
				{/if}
			{/each}
		{/if}
	</section>
</main>

<style>
	.job-detail {
		max-width: var(--container-md);
		margin: 0 auto;
		padding: var(--space-12) var(--space-6) var(--space-24);
	}

	.back-link {
		display: inline-block;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		text-decoration: none;
		margin-bottom: var(--space-6);
	}

	.back-link:hover {
		color: var(--text-secondary);
	}

	.stale-banner {
		padding: var(--space-3) var(--space-4);
		background: rgba(255, 176, 32, 0.1);
		border: 1px solid rgba(255, 176, 32, 0.3);
		border-radius: var(--radius-lg);
		color: var(--accent-amber);
		font-size: var(--text-sm);
		margin-bottom: var(--space-6);
	}

	.job-detail-header {
		margin-bottom: var(--space-8);
	}

	.job-company {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.job-title {
		font-size: var(--text-3xl);
		font-weight: 800;
		color: var(--text-primary);
		margin: var(--space-2) 0 var(--space-1);
	}

	.job-location {
		color: var(--text-tertiary);
		margin-bottom: var(--space-1);
	}

	.job-posted-date {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		margin-bottom: var(--space-4);
	}

	.job-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.meta-chip {
		display: inline-flex;
		align-items: center;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-full);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}

	/* same category coloring as the job board list, so a chip means the same
	   thing whichever page it's seen on. */
	.chip-remote {
		background: color-mix(in srgb, var(--accent-green) 15%, transparent);
		border-color: color-mix(in srgb, var(--accent-green) 40%, transparent);
		color: var(--accent-green);
	}

	.chip-hybrid {
		background: color-mix(in srgb, var(--accent-amber) 15%, transparent);
		border-color: color-mix(in srgb, var(--accent-amber) 40%, transparent);
		color: var(--accent-amber);
	}

	.chip-onsite {
		background: var(--glass-bg-hover);
		border-color: var(--glass-border);
		color: var(--text-secondary);
	}

	.chip-experience {
		background: color-mix(in srgb, var(--accent-pink) 12%, transparent);
		border-color: color-mix(in srgb, var(--accent-pink) 35%, transparent);
		color: var(--accent-pink);
	}

	.chip-compensation {
		background: color-mix(in srgb, var(--accent-purple) 15%, transparent);
		border-color: color-mix(in srgb, var(--accent-purple) 40%, transparent);
		color: var(--accent-purple);
	}

	.chip-relocation {
		background: color-mix(in srgb, var(--accent-teal) 15%, transparent);
		border-color: color-mix(in srgb, var(--accent-teal) 40%, transparent);
		color: var(--accent-teal);
	}

	.job-why {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		font-style: italic;
		margin-bottom: var(--space-6);
	}

	.job-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		padding: var(--space-3) var(--space-6);
		border-radius: var(--radius-full);
		font-weight: 600;
		font-size: var(--text-sm);
		text-decoration: none;
	}

	.btn-primary {
		background: var(--gradient-primary);
		color: var(--btn-text, #0a0e14);
	}

	.btn-secondary {
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		color: var(--text-primary);
	}

	.btn-secondary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.tracker-select {
		padding: var(--space-3) var(--space-5);
		border-radius: var(--radius-full);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		color: var(--text-primary);
		font-weight: 600;
		font-size: var(--text-sm);
		font-family: inherit;
	}

	.job-description h2 {
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: var(--space-3);
	}

	.job-description-text {
		color: var(--text-secondary);
		line-height: 1.7;
		margin-bottom: var(--space-4);
	}

	.job-description-text:last-child {
		margin-bottom: 0;
	}

	.job-description-list {
		color: var(--text-secondary);
		line-height: 1.7;
		margin: 0 0 var(--space-4);
		padding-left: 1.4em;
	}

	.job-description-list:last-child {
		margin-bottom: 0;
	}

	.job-description-list li {
		margin-bottom: var(--space-1);
	}
</style>
