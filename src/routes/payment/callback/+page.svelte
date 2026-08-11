<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { logger } from '$lib/log';
	import { authStore } from '$stores/auth.svelte';

	// Paystack redirects the browser back here after a checkout attempt with
	// ?reference=... in the query string. we settle the charge with the server
	// (which asks Paystack whether it really succeeded) and land the user back
	// on the scanner. the webhook settles independently if this ever fails, so
	// a slow redirect is not a lost payment — the account just gets credited a
	// moment later via the webhook path.

	const reference = $derived(page.url.searchParams.get('reference'));
	let status: 'verifying' | 'success' | 'failed' = $state('verifying');
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

		void (async () => {
			const { verifyPayment } = await import('$lib/payment');
			const ok = await verifyPayment(ref);
			if (!ok) {
				// webhook may still land the credit; the scanner's billing refresh
				// picks it up. do not block the user, just route back with a hint.
				logger.warn('payment.callback_unverified', { reference: ref });
				status = 'failed';
				error =
					"We couldn't confirm your payment just yet. If you were charged, your credit will arrive automatically in a moment — or retry below.";
				return;
			}
			status = 'success';
			void goto('/scanner', { replaceState: true });
		})();
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
			<p class="pay-text">Just a moment while we verify your review credit.</p>
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
