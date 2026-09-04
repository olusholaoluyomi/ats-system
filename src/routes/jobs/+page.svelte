<script lang="ts">
	import SeoHead from '$components/seo/SeoHead.svelte';
	import { currencySymbol } from '$lib/currency';
	import { timeAgo } from './shared';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const EXPERIENCE_LEVELS = [
		{ value: '', label: 'Any experience' },
		{ value: 'intern', label: 'Intern' },
		{ value: 'entry', label: 'Entry-level' },
		{ value: 'mid', label: 'Mid-level' },
		{ value: 'senior', label: 'Senior' },
		{ value: 'lead', label: 'Lead / Staff' }
	];

	function formatSalary(job: (typeof data.jobs)[number]): string | null {
		const c = job.classification;
		if (!c || (c.salaryMin == null && c.salaryMax == null)) return null;
		const symbol = c.salaryCurrency ? currencySymbol(c.salaryCurrency) : '';
		const period = c.salaryPeriod ? `/${c.salaryPeriod}` : '';
		if (c.salaryMin != null && c.salaryMax != null && c.salaryMin !== c.salaryMax) {
			return `${symbol}${c.salaryMin.toLocaleString()}–${symbol}${c.salaryMax.toLocaleString()}${period}`;
		}
		const single = c.salaryMin ?? c.salaryMax;
		return `${symbol}${single?.toLocaleString()}${period}`;
	}

	// filters narrow what's shown to the TOP of the list, they never hide
	// results outright - matchCount (from +page.server.ts) tells us where the
	// "matches your filters" group ends and the "other roles" group begins,
	// so someone whose filters happen to match nothing still sees the rest of
	// the board instead of a dead end.
	const hasActiveFilters = $derived(
		data.filters.remote ||
			data.filters.relocation ||
			Boolean(data.filters.experienceLevel) ||
			Boolean(data.filters.query)
	);
	const matchedJobs = $derived(hasActiveFilters ? data.jobs.slice(0, data.matchCount) : data.jobs);
	const otherJobs = $derived(hasActiveFilters ? data.jobs.slice(data.matchCount) : []);
</script>

<SeoHead
	title="Job Board | ATS Screener"
	description="Remote-friendly roles from real, verified companies - refreshed hourly. Filter by experience, relocation support, and salary, then check your ATS score before you apply."
/>

<main class="jobs-page">
	<header class="jobs-header">
		<div class="page-badge">Job Board</div>
		<h1 class="jobs-title">Roles posted in the last 48 hours</h1>
		<p class="jobs-subtitle">
			Pulled directly from real companies' own hiring pipelines - not a stale aggregator. Every
			listing is checked for remote-from-Africa friendliness and relocation support.
		</p>
	</header>

	<form method="GET" class="jobs-filters">
		<input
			type="search"
			name="q"
			class="filter-search"
			placeholder="Search job titles, e.g. Product Manager"
			value={data.filters.query ?? ''}
			maxlength="100"
			aria-label="Search job titles"
		/>
		<label class="filter-checkbox">
			<input type="checkbox" name="remote" value="true" checked={data.filters.remote} />
			Remote-friendly
		</label>
		<label class="filter-checkbox">
			<input type="checkbox" name="relocation" value="true" checked={data.filters.relocation} />
			Offers relocation
		</label>
		<select name="experienceLevel" class="filter-select">
			{#each EXPERIENCE_LEVELS as level (level.value)}
				<option value={level.value} selected={data.filters.experienceLevel === level.value}>
					{level.label}
				</option>
			{/each}
		</select>
		<button type="submit" class="filter-apply">Filter</button>
	</form>

	{#snippet jobCard(job: (typeof data.jobs)[number])}
		<a class="job-card" href="/jobs/{job.id}">
			<div class="job-card-header">
				<span class="job-company">{job.companyName}</span>
				<span class="job-posted">{timeAgo(job.firstSeenAt)}</span>
			</div>
			<h2 class="job-title">{job.title}</h2>
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
				{/if}
				{#if job.classification?.experienceLevel && job.classification.experienceLevel !== 'unclear'}
					<span class="meta-chip">{job.classification.experienceLevel}</span>
				{/if}
				{#if formatSalary(job)}
					<span class="meta-chip chip-salary">{formatSalary(job)}</span>
				{/if}
			</div>
			{#if job.whyThisCompany}
				<p class="job-why">{job.whyThisCompany}</p>
			{/if}
		</a>
	{/snippet}

	{#if data.jobs.length === 0}
		<p class="jobs-empty">
			No roles match right now - check back soon, the board refreshes every hour.
		</p>
	{:else}
		{#if hasActiveFilters && matchedJobs.length === 0}
			<p class="jobs-empty jobs-empty-inline">
				Nothing matches those filters right now - here's everything else currently on the board.
			</p>
		{/if}

		{#if hasActiveFilters && matchedJobs.length > 0}
			<h2 class="jobs-section-heading">Matching your filters</h2>
		{/if}
		{#if matchedJobs.length > 0}
			<div class="jobs-list">
				{#each matchedJobs as job (job.id)}
					{@render jobCard(job)}
				{/each}
			</div>
		{/if}

		{#if hasActiveFilters && otherJobs.length > 0}
			<h2 class="jobs-section-heading">Other roles</h2>
			<div class="jobs-list">
				{#each otherJobs as job (job.id)}
					{@render jobCard(job)}
				{/each}
			</div>
		{/if}
	{/if}
</main>

<style>
	.jobs-page {
		max-width: var(--container-lg);
		margin: 0 auto;
		padding: var(--space-12) var(--space-6) var(--space-24);
	}

	.jobs-header {
		text-align: center;
		margin-bottom: var(--space-8);
	}

	.page-badge {
		display: inline-flex;
		align-items: center;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-full);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		font-size: var(--text-xs);
		color: var(--text-secondary);
		margin-bottom: var(--space-4);
	}

	.jobs-title {
		font-size: var(--text-3xl);
		font-weight: 800;
		color: var(--text-primary);
		margin-bottom: var(--space-3);
	}

	.jobs-subtitle {
		color: var(--text-secondary);
		max-width: 640px;
		margin: 0 auto;
		line-height: 1.6;
	}

	.jobs-filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
		margin-bottom: var(--space-8);
	}

	.filter-search {
		flex: 1 1 240px;
		min-width: 200px;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		color: var(--text-primary);
		font-size: var(--text-sm);
	}

	.filter-search::placeholder {
		color: var(--text-tertiary);
	}

	.filter-checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		cursor: pointer;
	}

	.filter-select {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		color: var(--text-primary);
		font-size: var(--text-sm);
	}

	.filter-apply {
		margin-left: auto;
		padding: var(--space-2) var(--space-5);
		border-radius: var(--radius-full);
		border: none;
		background: var(--gradient-primary);
		color: var(--btn-text, #0a0e14);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.jobs-empty {
		text-align: center;
		color: var(--text-secondary);
		padding: var(--space-16) 0;
	}

	.jobs-empty-inline {
		padding: var(--space-4) 0 var(--space-6);
	}

	.jobs-section-heading {
		font-size: var(--text-sm);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
		margin: var(--space-8) 0 var(--space-4);
	}

	.jobs-section-heading:first-of-type {
		margin-top: 0;
	}

	.jobs-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: var(--space-5);
	}

	.job-card {
		display: block;
		padding: var(--space-5);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
		text-decoration: none;
		transition: border-color 0.2s ease;
	}

	.job-card:hover {
		border-color: var(--accent-border-hover);
	}

	.job-card-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: var(--space-2);
	}

	.job-company {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.job-posted {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.job-title {
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: var(--space-1);
	}

	.job-location {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		margin-bottom: var(--space-3);
	}

	.job-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
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
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		font-style: italic;
		margin-top: var(--space-2);
	}
</style>
