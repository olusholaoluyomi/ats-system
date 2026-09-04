<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import SeoHead from '$components/seo/SeoHead.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { profileStore } from '$stores/profile.svelte';
	import { timeAgo, formatPostedDate, workModeLabel, experienceLabel } from './shared';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// convenience default, not a hard override: a signed-in visitor who lands
	// on the board with no search of their own yet gets it pre-filled from
	// their saved profile preferences. only fires once per visit (prefilled
	// guard) and only when the URL carries no query params at all - the
	// moment someone filters manually, their own params always win.
	let prefilled = $state(false);
	$effect(() => {
		if (prefilled) return;
		if (page.url.search) {
			prefilled = true;
			return;
		}
		if (!(authStore.disabled || authStore.isAuthenticated)) return;
		profileStore.load().then(() => {
			if (prefilled || page.url.search) return;
			prefilled = true;
			const { preferredKeywords, preferredRemoteOnly } = profileStore.profile;
			if (!preferredKeywords && !preferredRemoteOnly) return;
			const parts: string[] = [];
			if (preferredKeywords) parts.push(`q=${encodeURIComponent(preferredKeywords)}`);
			if (preferredRemoteOnly) parts.push('remote=true');
			goto(`/jobs?${parts.join('&')}`, { replaceState: true, keepFocus: true, noScroll: true });
		});
	});

	const hasActiveFilters = $derived(
		data.filters.remote ||
			Boolean(data.filters.query) ||
			data.filters.experienceMin !== null ||
			data.filters.experienceMax !== null
	);

	// pagination is real cursor-based Firestore pagination (see
	// +page.server.ts) - these links carry the current search/filter params
	// forward alongside the cursor, so paging never drops what was searched
	// for. rebuilt from data.filters rather than parsing page.url.search, so
	// there's no mutable URLSearchParams instance to manage.
	function pageLink(direction: 'next' | 'prev'): string {
		const parts: string[] = [];
		if (data.filters.query) parts.push(`q=${encodeURIComponent(data.filters.query)}`);
		if (data.filters.remote) parts.push('remote=true');
		if (data.filters.experienceMin !== null)
			parts.push(`experienceMin=${data.filters.experienceMin}`);
		if (data.filters.experienceMax !== null)
			parts.push(`experienceMax=${data.filters.experienceMax}`);
		const cursor = direction === 'next' ? data.nextCursor : data.prevCursor;
		if (cursor)
			parts.push(`${direction === 'next' ? 'after' : 'before'}=${encodeURIComponent(cursor)}`);
		return `/jobs?${parts.join('&')}`;
	}
</script>

<SeoHead
	title="Job Board | ATS Screener"
	description="Remote-friendly roles from real companies, refreshed every few hours. Search by role, filter by remote, then check your ATS score before you apply."
/>

<main class="jobs-page">
	<header class="jobs-header">
		<div class="page-badge">Job Board</div>
		<h1 class="jobs-title">Roles posted in the last 48 hours</h1>
		<p class="jobs-subtitle">
			Pulled directly from real companies' own hiring pipelines - not a stale aggregator.
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
		<label class="filter-years">
			<span>Min years</span>
			<input
				type="number"
				name="experienceMin"
				min="0"
				max="40"
				value={data.filters.experienceMin ?? ''}
				class="filter-years-input"
			/>
		</label>
		<label class="filter-years">
			<span>Max years</span>
			<input
				type="number"
				name="experienceMax"
				min="0"
				max="40"
				value={data.filters.experienceMax ?? ''}
				class="filter-years-input"
			/>
		</label>
		<button type="submit" class="filter-apply">Search</button>
	</form>

	{#snippet jobCard(job: (typeof data.jobs)[number])}
		<a class="job-card" href="/jobs/{job.id}">
			<div class="job-card-header">
				<span class="job-company">{job.companyName}</span>
				<span class="job-posted" title={timeAgo(job.firstSeenAt)}>
					{formatPostedDate(job.firstSeenAt)}
				</span>
			</div>
			<h2 class="job-title">{job.title}</h2>
			<p class="job-location">{job.locationRaw || 'Location not specified'}</p>
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
		</a>
	{/snippet}

	{#if data.jobs.length === 0}
		<p class="jobs-empty">
			{hasActiveFilters
				? 'No roles match that search right now - try different keywords, or clear the filters to browse everything.'
				: 'No roles match right now - check back soon, the board refreshes every few hours.'}
		</p>
	{:else}
		<div class="jobs-list">
			{#each data.jobs as job (job.id)}
				{@render jobCard(job)}
			{/each}
		</div>
	{/if}

	{#if data.hasPrev || data.hasNext}
		<nav class="jobs-pagination" aria-label="Job board pages">
			{#if data.hasPrev}
				<a class="page-link" href={pageLink('prev')}>← Previous</a>
			{:else}
				<span class="page-link disabled">← Previous</span>
			{/if}
			{#if data.hasNext}
				<a class="page-link" href={pageLink('next')}>Next →</a>
			{:else}
				<span class="page-link disabled">Next →</span>
			{/if}
		</nav>
	{/if}
</main>

<style>
	.jobs-page {
		max-width: var(--container-xl);
		margin: 0 auto;
		/* 8rem clears the fixed navbar (63px) with room to spare - the previous
		   var(--space-12) (48px) sat under it, clipping the page-badge pill.
		   matches the top-padding convention other non-hero content pages
		   (e.g. /privacy) already use. */
		padding: 8rem var(--space-6) var(--space-24);
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
		/* a global h1 reset caps max-inline-size at ~400px, which shrinks this
		   h1's own box well below .jobs-header's width - text-align:center
		   then only centers the text WITHIN that narrow box, not the box
		   itself, so the title visibly sits left-shifted next to the
		   (full-width) badge and subtitle above/below it. overriding it back
		   to the full available width is what actually centers it. */
		max-width: none;
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

	.filter-years {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.filter-years-input {
		width: 4.5rem;
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

	.jobs-pagination {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-4);
		margin-top: var(--space-10);
	}

	.page-link {
		padding: var(--space-2) var(--space-5);
		border-radius: var(--radius-full);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		color: var(--text-primary);
		font-weight: 600;
		font-size: var(--text-sm);
		text-decoration: none;
	}

	.page-link:hover {
		border-color: var(--accent-border-hover);
	}

	.page-link.disabled {
		color: var(--text-tertiary);
		opacity: 0.5;
		pointer-events: none;
	}

	.jobs-list {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-5);
	}

	.job-card {
		display: block;
		padding: var(--space-5);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
		text-decoration: none;
		transition:
			border-color 0.2s ease,
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}

	.job-card:hover {
		border-color: var(--accent-border-hover);
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
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
		align-items: center;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-full);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}

	/* each chip category gets its own accent so a card reads at a glance
	   instead of as one flat wall of gray pills - work mode is the most
	   important signal so it gets the strongest colors; onsite (the
	   unremarkable default) stays the plainest of the three. */
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
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		font-style: italic;
		margin-top: var(--space-2);
	}

	/* the 4-column grid needs explicit tapering (unlike the old auto-fill
	   version, which self-adjusted) so cards don't get crushed narrow on
	   tablet/mobile. */
	@media (max-width: 1200px) {
		.jobs-list {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 640px) {
		.jobs-page {
			padding-top: 6.5rem;
		}

		.jobs-list {
			grid-template-columns: 1fr;
		}

		.jobs-filters {
			flex-direction: column;
			align-items: stretch;
		}

		.filter-apply {
			margin-left: 0;
		}
	}
</style>
