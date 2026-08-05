<section class="cta">
	<div class="cta-bg">
		<div class="cta-orb cta-orb-1"></div>
		<div class="cta-orb cta-orb-2"></div>
	</div>

	<div class="cta-content">
		<h2 class="cta-title">
			Stop guessing.
			<br />
			<span class="gradient-text">Start scoring.</span>
		</h2>
		<p class="cta-description">
			Upload your resume and get real ATS scores in under 30 seconds. It's free right now - pricing
			is coming, so lock in your score before anything changes. Just accurate, platform-specific
			feedback.
		</p>
		<div class="cta-actions">
			<a href="/scanner" class="cta-button">
				<span class="btn-shimmer"></span>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14,2 14,8 20,8" />
					<path d="M12 18v-6" />
					<path d="M9 15l3 3 3-3" />
				</svg>
				Scan Your Resume Free
			</a>
		</div>
	</div>
</section>

<style>
	.cta {
		position: relative;
		padding: 5rem 2rem 8rem;
		text-align: center;
		overflow: hidden;
	}

	.cta-bg {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}

	.cta-orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(120px);
	}

	.cta-orb-1 {
		width: 500px;
		height: 500px;
		background: var(--accent-tint);
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
	}

	.cta-orb-2 {
		width: 400px;
		height: 400px;
		background: rgba(59, 130, 246, 0.06);
		top: 30%;
		left: 60%;
		transform: translate(-50%, -50%);
	}

	.cta-content {
		position: relative;
		max-width: 700px;
		margin: 0 auto;
	}

	.cta-title {
		font-size: clamp(2.25rem, 6vw, 3.75rem);
		font-weight: 800;
		color: var(--text-primary);
		letter-spacing: -0.04em;
		line-height: 1.1;
		margin-bottom: 1.5rem;
	}

	.gradient-text {
		background: var(--gradient-primary);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.cta-description {
		font-size: 1.15rem;
		color: var(--text-secondary);
		line-height: 1.7;
		margin-bottom: 2.5rem;
		max-width: 560px;
		margin-left: auto;
		margin-right: auto;
	}

	.cta-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1.25rem;
		flex-wrap: wrap;
	}

	.cta-button {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 1.1rem 2.5rem;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--btn-text);
		background: var(--gradient-primary);
		border-radius: var(--radius-lg);
		text-decoration: none;
		overflow: hidden;
		transition:
			transform 0.25s ease,
			box-shadow 0.25s ease;
	}

	.cta-button:hover {
		transform: translateY(-3px);
		box-shadow:
			0 0 40px var(--accent-border-hover),
			0 0 80px rgba(59, 130, 246, 0.15);
		color: var(--btn-text);
	}

	.btn-shimmer {
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
		animation: shimmer 3s ease-in-out infinite;
	}

	@keyframes shimmer {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(100%);
		}
	}

	@media (max-width: 640px) {
		.cta {
			padding: 5rem 1.5rem;
		}

		.cta-actions {
			flex-direction: column;
		}
	}
</style>
