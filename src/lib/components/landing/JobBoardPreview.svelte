<script lang="ts">
	import { timeAgo } from '../../../routes/jobs/shared';
	import type { JobListing } from '../../../routes/jobs/shared';

	let { jobs }: { jobs: JobListing[] } = $props();
</script>

<section class="job-preview" id="jobs">
	<div class="job-preview-header">
		<div class="section-badge">
			<span class="badge-icon">
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<rect x="2" y="7" width="20" height="14" rx="2" />
					<path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
				</svg>
			</span>
			<span>Now with a Job Board</span>
		</div>
		<h2 class="section-title">
			Find the Role.
			<span class="gradient-text">Know Your Score First.</span>
		</h2>
		<p class="section-description">
			Real openings from real companies, refreshed hourly. Most rejections happen inside the ATS
			before a recruiter ever opens your resume, so every listing has a "Check my score" step before
			you apply.
		</p>
	</div>

	{#if jobs.length > 0}
		<div class="job-preview-grid">
			{#each jobs as job (job.id)}
				<a class="job-preview-card" href="/jobs/{job.id}">
					<div class="job-preview-top">
						<span class="job-preview-company">{job.companyName}</span>
						<span class="job-preview-posted">{timeAgo(job.firstSeenAt)}</span>
					</div>
					<h3 class="job-preview-title">{job.title}</h3>
					<p class="job-preview-location">{job.locationRaw || 'Location not specified'}</p>
					<div class="job-preview-chips">
						{#if job.remote}
							<span class="meta-chip">Remote</span>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{:else}
		<p class="job-preview-empty">
			New roles land on the board every hour - be the first to see them.
		</p>
	{/if}

	<a href="/jobs" class="job-preview-cta">
		Browse the Job Board
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<path d="M5 12h14" />
			<path d="m12 5 7 7-7 7" />
		</svg>
	</a>
</section>

<style>
	.job-preview {
		padding: 6rem 2rem 4rem;
		max-width: 1400px;
		margin: 0 auto;
	}

	.job-preview-header {
		text-align: center;
		margin-bottom: 3.5rem;
	}

	.section-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 1rem;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
		backdrop-filter: blur(12px);
		letter-spacing: 0.02em;
	}

	.badge-icon {
		display: inline-flex;
		color: var(--accent-text);
	}

	.section-title {
		font-size: clamp(2rem, 5vw, 3.25rem);
		font-weight: 800;
		color: var(--text-primary);
		margin-bottom: 1.25rem;
		letter-spacing: -0.03em;
		line-height: 1.15;
	}

	.gradient-text {
		background: var(--gradient-primary);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.section-description {
		font-size: clamp(1rem, 2vw, 1.2rem);
		color: var(--text-secondary);
		max-width: 720px;
		margin: 0 auto;
		line-height: 1.7;
	}

	.job-preview-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1.5rem;
		margin-bottom: 2.5rem;
	}

	.job-preview-card {
		display: block;
		padding: 1.5rem;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
		text-decoration: none;
		transition:
			border-color 0.25s ease,
			transform 0.25s ease;
	}

	.job-preview-card:hover {
		border-color: var(--accent-border-hover);
		transform: translateY(-4px);
	}

	.job-preview-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.5rem;
	}

	.job-preview-company {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.job-preview-posted {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.job-preview-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.25rem;
	}

	.job-preview-location {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		margin-bottom: 0.85rem;
	}

	.job-preview-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.meta-chip {
		display: inline-flex;
		padding: 0.25rem 0.7rem;
		border-radius: var(--radius-full);
		background: var(--glass-bg-hover);
		border: 1px solid var(--glass-border);
		font-size: 0.72rem;
		color: var(--text-secondary);
	}

	.job-preview-empty {
		text-align: center;
		color: var(--text-secondary);
		padding: 2.5rem 0;
	}

	.job-preview-cta {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: fit-content;
		margin: 0 auto;
		padding: 0.85rem 1.75rem;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		text-decoration: none;
		transition:
			border-color 0.25s ease,
			transform 0.25s ease;
	}

	.job-preview-cta:hover {
		border-color: var(--accent-border-hover);
		color: var(--accent-text);
		transform: translateY(-2px);
	}

	@media (max-width: 640px) {
		.job-preview {
			padding: 4rem 1.5rem 3rem;
		}
	}
</style>
