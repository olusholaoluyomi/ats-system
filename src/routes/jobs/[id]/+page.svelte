<script lang="ts">
	import SeoHead from '$components/seo/SeoHead.svelte';
	import { currencySymbol } from '$lib/currency';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const job = $derived(data.job);

	const salaryText = $derived.by(() => {
		const c = job.classification;
		if (!c || (c.salaryMin == null && c.salaryMax == null)) return null;
		const symbol = c.salaryCurrency ? currencySymbol(c.salaryCurrency) : '';
		const period = c.salaryPeriod ? `/${c.salaryPeriod}` : '';
		if (c.salaryMin != null && c.salaryMax != null && c.salaryMin !== c.salaryMax) {
			return `${symbol}${c.salaryMin.toLocaleString()}–${symbol}${c.salaryMax.toLocaleString()}${period}`;
		}
		const single = c.salaryMin ?? c.salaryMax;
		return `${symbol}${single?.toLocaleString()}${period}`;
	});
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

		<div class="job-chips">
			{#if job.remote}
				<span class="meta-chip">Remote</span>
			{/if}
			{#if job.classification?.africaRemoteFriendly}
				<span class="meta-chip chip-accent">Africa remote-friendly</span>
			{/if}
			{#if job.classification?.relocationOffered === true}
				<span class="meta-chip chip-accent">Relocation offered</span>
			{:else if job.classification?.relocationRequired}
				<span class="meta-chip">Relocation required</span>
			{/if}
			{#if job.classification?.experienceLevel && job.classification.experienceLevel !== 'unclear'}
				<span class="meta-chip">{job.classification.experienceLevel}</span>
			{/if}
			{#if salaryText}
				<span class="meta-chip chip-salary">{salaryText}</span>
			{/if}
		</div>

		{#if job.whyThisCompany}
			<p class="job-why">{job.whyThisCompany}</p>
		{/if}

		<div class="job-actions">
			<a class="btn-primary" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
				Apply on {job.companyName}'s site
			</a>
			<a class="btn-secondary" href="/scanner?jobId={job.id}">Check my CV Score first</a>
		</div>
	</header>

	<section class="job-description">
		<h2>Full description</h2>
		<p class="job-description-text">{job.descriptionText || 'No description available.'}</p>
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
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-full);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.chip-accent {
		background: var(--accent-tint);
		border-color: var(--accent-border);
		color: var(--accent-text);
	}

	.chip-salary {
		background: rgba(0, 230, 118, 0.09);
		border-color: rgba(0, 230, 118, 0.28);
		color: var(--accent-green);
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

	.job-description h2 {
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: var(--space-3);
	}

	.job-description-text {
		white-space: pre-wrap;
		color: var(--text-secondary);
		line-height: 1.7;
	}
</style>
