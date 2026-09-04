<script lang="ts">
	const steps = [
		{
			number: '01',
			title: 'Find the Job',
			description:
				'Browse real, remote-friendly openings on the job board - refreshed hourly, straight from company hiring pipelines.',
			icon: 'briefcase',
			accent: '#06b6d4'
		},
		{
			number: '02',
			title: 'Check Your Score',
			description:
				'Hit "Check my CV Score" on any listing to score against that exact job - or paste any JD yourself.',
			icon: 'target',
			accent: '#3b82f6'
		},
		{
			number: '03',
			title: 'Upload Your Resume',
			description:
				'PDF or DOCX. Parsed entirely client-side in a Web Worker. The file itself is never uploaded.',
			icon: 'upload',
			accent: '#8b5cf6'
		},
		{
			number: '04',
			title: 'Get Scored by 6 Systems',
			description:
				'Each platform scores differently. Workday, Taleo, iCIMS, Greenhouse, Lever, SuccessFactors.',
			icon: 'zap',
			accent: '#ec4899'
		},
		{
			number: '05',
			title: 'Make Changes (If Needed)',
			description:
				'Per-system breakdown: formatting, keywords, sections, experience, education. Fix it, rescan.',
			icon: 'edit',
			accent: '#f97316'
		},
		{
			number: '06',
			title: 'Apply With Confidence',
			description: 'Once your score holds up, apply straight from the listing - no more guessing.',
			icon: 'send',
			accent: '#22c55e'
		}
	];
</script>

<section id="how-it-works" class="how-it-works">
	<div class="section-header">
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
					<path
						d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
					/>
				</svg>
			</span>
			<span>How It Works</span>
		</div>
		<h2 class="section-title">
			Six Steps
			<span class="gradient-text">From Job to Offer</span>
		</h2>
	</div>

	<div class="steps-grid">
		{#each steps as step, i}
			<div class="step-card" style="--accent: {step.accent}; --delay: {i * 0.1}s">
				<!-- step number badge -->
				<div class="step-number">{step.number}</div>

				<!-- icon -->
				<div class="step-icon">
					{#if step.icon === 'briefcase'}
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<rect x="2" y="7" width="20" height="14" rx="2" />
							<path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
						</svg>
					{:else if step.icon === 'target'}
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<circle cx="12" cy="12" r="10" />
							<circle cx="12" cy="12" r="6" />
							<circle cx="12" cy="12" r="2" />
						</svg>
					{:else if step.icon === 'upload'}
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="17,8 12,3 7,8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
					{:else if step.icon === 'zap'}
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2" />
						</svg>
					{:else if step.icon === 'edit'}
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<path d="M12 20h9" />
							<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
						</svg>
					{:else if step.icon === 'send'}
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<path d="m22 2-7 20-4-9-9-4Z" />
							<path d="M22 2 11 13" />
						</svg>
					{/if}
				</div>

				<h3 class="step-title">{step.title}</h3>
				<p class="step-description">{step.description}</p>

				<!-- connecting arrow: only between cards in the same row, never
				     spanning the wrap to the next row -->
				{#if i < steps.length - 1 && (i + 1) % 3 !== 0}
					<div class="step-arrow">
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<line x1="5" y1="12" x2="19" y2="12" />
							<polyline points="12,5 19,12 12,19" />
						</svg>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>

<style>
	.how-it-works {
		padding: 4rem 2rem;
		max-width: 1200px;
		margin: 0 auto;
	}

	.section-header {
		text-align: center;
		margin-bottom: 4rem;
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
		letter-spacing: -0.03em;
		line-height: 1.15;
	}

	.gradient-text {
		background: var(--gradient-primary);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	/* 3-column card grid: two rows of three for the six steps */
	.steps-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.25rem;
	}

	.step-card {
		position: relative;
		padding: 1.75rem 1.5rem;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
		backdrop-filter: blur(var(--glass-blur));
		transition:
			border-color 0.3s ease,
			transform 0.25s ease,
			box-shadow 0.3s ease;
		animation: card-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) backwards;
		animation-delay: var(--delay);
	}

	@keyframes card-in {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
	}

	.step-card:hover {
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
		transform: translateY(-4px);
		box-shadow: 0 8px 32px color-mix(in srgb, var(--accent) 8%, transparent);
	}

	.step-number {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		color: var(--accent-text);
		font-size: 0.7rem;
		font-weight: 800;
		margin-bottom: 1.25rem;
	}

	.step-icon {
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent-text);
		margin-bottom: 1rem;
	}

	.step-title {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.5rem;
		letter-spacing: -0.01em;
	}

	.step-description {
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	/* connecting arrow between cards */
	.step-arrow {
		position: absolute;
		right: -20px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--glass-border);
		z-index: 2;
		opacity: 0.4;
	}

	@media (max-width: 900px) {
		.steps-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 1rem;
		}

		.step-arrow {
			display: none;
		}
	}

	@media (max-width: 500px) {
		.steps-grid {
			grid-template-columns: 1fr;
		}

		.how-it-works {
			padding: 3rem 1.5rem;
		}
	}
</style>
