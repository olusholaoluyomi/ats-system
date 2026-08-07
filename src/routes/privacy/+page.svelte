<script lang="ts">
	import SeoHead from '$components/seo/SeoHead.svelte';

	const CONTACT_EMAIL = 'olushoaloluyomi@gmail.com';
	const LAST_UPDATED = '2026-08-06';
</script>

<SeoHead
	title="Privacy Policy | ATS Screener"
	description="How ATS Screener collects, uses, retains, and protects your data. Plain-language coverage of what we collect, what we do not, and your rights."
/>

<main class="privacy-page">
	<div class="container">
		<div class="page-badge">
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
			</svg>
			<span>Privacy</span>
		</div>

		<h1 class="page-title">Privacy and Data Handling</h1>
		<p class="page-subtitle">
			How ATS Screener collects, uses, retains, and protects your data. Plain language, no legalese.
			The author is not a lawyer. Last updated {LAST_UPDATED}.
		</p>

		<div class="prose">
			<section>
				<h2>What this is (and what it is not)</h2>
				<p>
					ATS Screener is a personal project run by <strong>Oluyomi Olushola Michael</strong>. It is
					free to use:
				</p>
				<ul>
					<li>No ads.</li>
					<li>No premium tier or paid features.</li>
					<li>No data sales.</li>
				</ul>
				<p>
					It is not a registered business or service, and there is no organization behind it. That
					framing matters for everything below.
				</p>
				<p>
					ATS Screener is inspired by and built on the open-source ATS Screener by
					<a href="https://sunnypatel.net" target="_blank" rel="noopener">Sunny Patel</a> — thank you
					for the open-source material that made this possible.
				</p>
			</section>

			<section>
				<h2>Where you fit in</h2>
				<p>
					Anyone, anywhere, can use ATS Screener. The app is hosted on US-based infrastructure and
					accepts users from any country.
				</p>
			</section>

			<section>
				<h2>Honest legal framing</h2>
				<p>
					Most commercial data-protection statutes are written for commercial activity. A personal
					project may not formally fall under their organizational obligations. Here is the author's
					good-faith reading, not legal advice:
				</p>
				<ul>
					<li>
						<strong>PIPEDA (Canada)</strong> applies to "commercial activity". The project itself charges
						nothing and gates no features behind payment, so PIPEDA's organizational requirements likely
						do not formally apply.
					</li>
					<li>
						<strong>CCPA / CPRA (California)</strong> applies to businesses meeting revenue and data thresholds
						(annual revenue &gt; $25M, or processing data from 100k+ Californians, or &gt; 50% revenue
						from selling personal info). A free personal project does not come close to any of those thresholds.
					</li>
					<li>
						<strong>GDPR (EU/EEA)</strong> is broader. Its household exemption excludes purely personal
						activity, but a public-facing global service generally falls outside that exemption. So if
						you live in the EU/EEA and create an account, GDPR may technically apply to the way the author
						processes your data, regardless of monetization.
					</li>
				</ul>
				<p>
					If you are unsure which laws apply to your situation, you should consult someone who
					actually does this for a living. The practical commitment in the next section applies to
					every user regardless of which statutes formally bind us.
				</p>
			</section>

			<section>
				<h2>Practical commitment</h2>
				<p>
					Whether or not a given law strictly applies, we operate as if a baseline of good privacy
					hygiene does. Regardless of where you live:
				</p>
				<ul>
					<li>We do not sell your data.</li>
					<li>We do not run advertising trackers or behavioural-analytics pixels.</li>
					<li>You can ask for a copy of what we hold about you.</li>
					<li>You can ask us to delete your account and your scan history.</li>
					<li>We will tell you, on this page, what we collect and why.</li>
				</ul>
			</section>

			<section>
				<h2>How you can use the app</h2>
				<ul>
					<li>
						<strong>Signed in.</strong> Signing in is required to use the scanner. When you sign in, the
						app stores your account info plus your scan history (capped at the most recent 5 scans). The
						next section covers exactly what that includes.
					</li>
				</ul>
			</section>

			<section>
				<h2>What we collect from signed-in users</h2>
				<p><strong>Account information</strong>, from your sign-in provider:</p>
				<ul>
					<li>Your email address.</li>
					<li>Your display name.</li>
					<li>Your profile photo, if available.</li>
					<li>We never see or store your password.</li>
				</ul>
				<p><strong>Scan history</strong>, capped at your 5 most recent scans:</p>
				<ul>
					<li>Numeric scores per ATS profile.</li>
					<li>Lists of matched and missing keywords derived from your resume.</li>
					<li>The file name you uploaded.</li>
					<li>The scan timestamp and mode (general or targeted).</li>
					<li>A short snippet of the job description, up to 200 characters.</li>
				</ul>
				<p>
					PDF and DOCX parsing happens entirely inside your browser. The binary file itself is never
					sent over the network.
				</p>
			</section>

			<section>
				<h2>How we process scoring requests</h2>
				<p>
					When you run a scan, the extracted resume text (and, in targeted mode, the full job
					description text) is sent over TLS to one of our AI scoring providers via our serverless
					function. Two things to be honest about:
				</p>
				<ol>
					<li>
						<strong>The text passes through our serverless function</strong> on the way to the AI provider.
						We do not write it to durable storage. A short-lived in-memory cache (per region, max 200
						entries, 24-hour TTL, never written to disk) deduplicates identical repeat requests so the
						provider is not called twice for the same prompt. That cache disappears whenever the serverless
						instance recycles, which is usually within minutes.
					</li>
					<li>
						<strong>The AI providers receive your resume text.</strong> Their privacy practices apply
						to data they receive. We choose providers whose terms permit transient processing without
						long-term retention, but they are independent third parties.
					</li>
				</ol>
				<p>
					The full prompt and the raw provider response are not retained on our servers as durable
					data.
				</p>
			</section>

			<section>
				<h2>What we do not collect</h2>
				<ul>
					<li>We do not sell your data, full stop.</li>
					<li>
						We do not run third-party advertising trackers, marketing pixels, or session-replay
						tools.
					</li>
					<li>
						We do not store the full text of your resume or the full text of your job description as
						durable data. We do save the numeric scores and the matched / missing keyword lists
						derived from them, plus a short JD snippet (up to 200 characters), to your scan history.
					</li>
					<li>We do not store the binary contents of your uploaded PDF or DOCX file.</li>
					<li>We do not share your scan results with employers or recruiters.</li>
				</ul>
			</section>

			<section>
				<h2>Where account data lives</h2>
				<p>
					Account info and scan history are stored in a managed cloud database operated by a
					well-known third-party provider, with access restricted to your account. Data is stored in
					the United States. Data in transit is encrypted with TLS, and the provider encrypts data
					at rest.
				</p>
			</section>

			<section>
				<h2>How long we keep it</h2>
				<ul>
					<li>
						Scan history is capped at your 5 most recent scans. Older scans are deleted
						automatically on the next save.
					</li>
					<li>
						You can clear all of your scan history at any time from the History page in the app.
					</li>
					<li>Account information persists until you ask us to delete your account.</li>
					<li>
						Operational logs (request counts, error codes, response timings) are retained briefly by
						hosting infrastructure for diagnostics and rotate out automatically.
					</li>
				</ul>
			</section>

			<section>
				<h2>Your practical rights, regardless of jurisdiction</h2>
				<ul>
					<li>
						<strong>Access.</strong> Email us and we will send you whatever account and history data we
						hold about you.
					</li>
					<li><strong>Correct.</strong> Email us if a stored field is wrong.</li>
					<li>
						<strong>Delete.</strong> Use the in-app "clear history" control to erase scan data, or email
						us to delete your full account.
					</li>
					<li><strong>Withdraw consent.</strong> Sign out and ask us to delete your account.</li>
				</ul>
				<p>
					If you live in a jurisdiction with a data-protection authority (Canada's
					<a href="https://www.priv.gc.ca/" target="_blank" rel="noopener">
						Office of the Privacy Commissioner
					</a>
					, an EU/EEA national DPA, the UK ICO, etc.) and you believe we have not handled your data appropriately,
					you may also contact them.
				</p>
			</section>

			<section>
				<h2>Cookies and similar technologies</h2>
				<p>
					The app uses only what is required for sign-in (the auth provider sets cookies and local
					storage to remember your session). We do not use cookies or local storage for behavioural
					tracking or advertising.
				</p>
			</section>

			<section>
				<h2>Children</h2>
				<p>
					This app is not directed at children under 13, and we do not knowingly collect data from
					them.
				</p>
			</section>

			<section>
				<h2>Changes to this notice</h2>
				<p>
					If something material changes, we will update the "Last updated" date at the top of this
					page. Worth checking back on occasion if you care about the details.
				</p>
			</section>

			<section>
				<h2>Contact</h2>
				<p>
					Email
					<a href="mailto:{CONTACT_EMAIL}" class="email-link">{CONTACT_EMAIL}</a>
					for any privacy question, data access request, correction, or deletion request.
				</p>
				<p>
					This document is written in plain language because legalese hides accountability. If
					anything here is unclear or seems wrong, write in.
				</p>
			</section>
		</div>
	</div>
</main>

<style>
	.privacy-page {
		position: relative;
		min-height: 100dvh;
		padding: 8rem 2rem 5rem;
	}

	.container {
		max-width: 860px;
		margin: 0 auto;
	}

	.page-badge {
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
	}

	.page-badge svg {
		color: var(--accent-text);
	}

	.page-title {
		font-size: clamp(2rem, 5vw, 3rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		margin-bottom: 0.75rem;
		color: var(--text-primary);
		line-height: 1.15;
	}

	.page-subtitle {
		font-size: 1.05rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin-bottom: 2.5rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--glass-border);
	}

	.prose section {
		margin-bottom: 2.25rem;
	}

	.prose h2 {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.75rem;
		letter-spacing: -0.01em;
	}

	.prose p {
		font-size: 0.95rem;
		color: var(--text-secondary);
		line-height: 1.7;
		margin-bottom: 0.85rem;
	}

	.prose ul,
	.prose ol {
		margin: 0 0 0.85rem;
		padding-left: 1.5rem;
	}

	.prose li {
		font-size: 0.95rem;
		color: var(--text-secondary);
		line-height: 1.7;
		margin-bottom: 0.4rem;
	}

	.prose a {
		color: var(--accent-text);
		text-decoration: none;
		border-bottom: 1px solid transparent;
		transition: border-color 0.15s ease;
	}

	.prose a:hover,
	.prose a:focus-visible {
		border-bottom-color: var(--accent-text);
	}

	.prose strong {
		color: var(--text-primary);
		font-weight: 600;
	}

	@media (max-width: 640px) {
		.privacy-page {
			padding: 6.5rem 1.5rem 3rem;
		}
	}
</style>
