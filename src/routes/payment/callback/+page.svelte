<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { logger } from '$lib/log';
	import { authStore } from '$stores/auth.svelte';

	// Paystack redirects the browser back here after a checkout attempt with
	// ?reference=... in the query string. we settle the charge with the server
	// (which asks Paystack whether it really succeeded) and land the user back
	// on the scanner. the webhook settles independently when the in-browser
	// verify cannot confirm right away, so a slow confirmation is never a lost
	// payment: /api/payment/verify short-circuits to success once the webhook
	// credits, so polling it covers both the direct and the webhook path.

	const reference = $derived(page.url.searchParams.get('reference'));
	let status: 'verifying' | 'success' | 'failed' = $state('verifying');
	// true once the fast retries are exhausted but the webhook may still be
	// landing the credit; the page keeps watching and auto-redirects.
	let slow = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (!browser) return;
		if (authStore.loading) return;

		const ref = reference;
		if (!ref) {
			// no reference: nothing to verify (direct visit / cancelled before
			// checkout). send them back rather than showing a dead end.
			void goto('/scanner', { replaceState: true });
			return;
		}

		let cancelled = false;

		const confirmAndGo = () => {
			status = 'success';
			void goto('/scanner', { replaceState: true });
		};

		const settle = async (): Promise<boolean> => {
			const { verifyPayment } = await import('$lib/payment');
			return verifyPayment(ref);
		};

		void (async () => {
			// fast retries: the charge can still be settling in Paystack's view
			// when the browser lands back, and the verify round-trip can fail
			// transiently. give it a few tries before assuming the worst.
			for (let attempt = 1; attempt <= 3; attempt++) {
				if (cancelled) return;
				if (await settle()) return confirmAndGo();
				if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
			}

			// the webhook may still land the credit server-to-server. keep
			// polling verify - it reports success once the webhook credits - and
			// auto-redirect so "arrives automatically" is actually true.
			slow = true;
			const deadline = Date.now() + 90_000;
			while (!cancelled && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 4000));
				if (cancelled) return;
				if (await settle()) return confirmAndGo();
			}

			if (cancelled) return;
			logger.warn('payment.callback_unverified', { reference: ref });
			status = 'failed';
			error =
				"We couldn't confirm your payment just yet. If you were charged, your credit will arrive automatically in a moment — or retry below.";
		})();

		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:head>
	<title>Payment | ATS Screener</title>
</svelte:head>

<main class="pay-callback">
	<div class="pay-card">
		{#if status === 'verifying'}
			<div class="spinner-lg"></div>
			<h1 class="pay-title">Confirming your payment…</h1>
			<p class="pay-text">
				{#if slow}
					Still confirming — if you were charged, your credit will be applied automatically and
					we'll take you to the scanner.
				{:else}
					Just a moment while we verify your review credit.
				{/if}
			</p>
		{:else if status === 'success'}
			<div class="pay-check">✓</div>
			<h1 class="pay-title">Payment confirmed</h1>
			<p class="pay-text">Your review credit has been added. Taking you to the scanner…</p>
		{:else}
			<div class="pay-check pay-fail">!</div>
			<h1 class="pay-title">Almost there</h1>
			<p class="pay-text">{error}</p>
			<div class="pay-actions">
				<button class="pay-btn" onclick={() => (location.href = '/scanner')}>
					Back to Scanner
				</button>
				<button class="pay-btn pay-btn-secondary" onclick={() => location.reload()}>
					Retry Verification
				</button>
			</div>
		{/if}
	</div>
</main>

<style>
	.pay-callback {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		padding: 2rem;
	}

	.pay-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		max-width: 440px;
		padding: 3rem 2.5rem;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
		backdrop-filter: blur(20px);
	}

	.spinner-lg {
		width: 36px;
		height: 36px;
		border: 3px solid var(--glass-border);
		border-top-color: var(--accent-text);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin-bottom: 1rem;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.pay-check {
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: rgba(34, 197, 94, 0.12);
		color: #22c55e;
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 1rem;
	}

	.pay-fail {
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
	}

	.pay-title {
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.6rem;
	}

	.pay-text {
		font-size: 0.9rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.pay-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	.pay-btn {
		padding: 0.65rem 1.5rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--btn-text);
		background: var(--gradient-primary);
		border: none;
		border-radius: var(--radius-full);
		cursor: pointer;
	}

	.pay-btn-secondary {
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		color: var(--text-secondary);
	}
</style>
