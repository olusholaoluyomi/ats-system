<script lang="ts">
	import { onMount } from 'svelte';
	import { getFirebase } from '$lib/firebase';
	import { authStore } from '$stores/auth.svelte';
	import SeoHead from '$components/seo/SeoHead.svelte';

	interface Payment {
		id: string;
		reference: string;
		amountMinor: number | null;
		currency: string | null;
		status: string | null;
		createdAt: string | null;
		scansAllowed: number | null;
		isSubscription: boolean | null;
		email: string | null;
	}

	interface BillingState {
		freeUsed: boolean;
		credits: number;
		subscriptionType: 'free' | 'one-time' | 'monthly';
		subscriptionExpiresAt: Date | null;
		reviewsThisMonth: number;
	}

	let payments = $state<Payment[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let billingState = $state<BillingState>({
		freeUsed: false,
		credits: 4,
		subscriptionType: 'free',
		subscriptionExpiresAt: null,
		reviewsThisMonth: 0
	});

	onMount(async () => {
		if (!authStore.isAuthenticated) {
			window.location.href = '/login';
			return;
		}

		try {
			const { db } = await getFirebase();
			const { collection, query, where, orderBy, getDocs, doc, getDoc } =
				await import('firebase/firestore');

			// Get billing info
			const billingRef = doc(db, 'users', authStore.user!.uid, 'billing', 'state');
			const billingSnap = await getDoc(billingRef);
			const billing = billingSnap.exists() ? billingSnap.data() : {};

			// Get payment history
			const paymentsQuery = query(
				collection(db, 'payments'),
				where('uid', '==', authStore.user!.uid),
				orderBy('createdAt', 'desc')
			);
			const paymentsSnap = await getDocs(paymentsQuery);

			payments = paymentsSnap.docs.map((d) => {
				const data = d.data() as Record<string, unknown>;
				const created = data.createdAt;
				let createdIso = null;
				if (created && typeof (created as { toDate?: () => Date }).toDate === 'function') {
					createdIso = (created as { toDate: () => Date }).toDate().toISOString();
				} else if (created instanceof Date) {
					createdIso = created.toISOString();
				} else if (typeof created === 'string') {
					createdIso = created;
				}

				return {
					id: d.id,
					reference: typeof data.reference === 'string' ? data.reference : d.id,
					amountMinor: typeof data.amountMinor === 'number' ? data.amountMinor : null,
					currency: typeof data.currency === 'string' ? data.currency : null,
					status: typeof data.status === 'string' ? data.status : null,
					createdAt: createdIso,
					scansAllowed: typeof data.scansAllowed === 'number' ? data.scansAllowed : null,
					isSubscription: data.isSubscription === true,
					email: typeof data.email === 'string' ? data.email : null
				};
			});

			// Update billing state
			billingState = {
				freeUsed: billing.freeUsed === true,
				credits: typeof billing.credits === 'number' ? billing.credits : 4,
				subscriptionType: (billing.subscriptionType as 'free' | 'one-time' | 'monthly') || 'free',
				subscriptionExpiresAt:
					billing.subscriptionExpiresAt && typeof billing.subscriptionExpiresAt === 'string'
						? new Date(billing.subscriptionExpiresAt)
						: billing.subscriptionExpiresAt instanceof Date
							? billing.subscriptionExpiresAt
							: null,
				reviewsThisMonth:
					typeof billing.reviewsThisMonth === 'number' ? billing.reviewsThisMonth : 0
			};
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load subscriptions';
			console.error('Error loading subscriptions:', err);
		} finally {
			loading = false;
		}
	});

	function formatCurrency(amount: number, currency: string | null): string {
		const symbols: Record<string, string> = {
			NGN: '₦',
			USD: '$',
			GHS: 'GH₵',
			KES: 'KSh',
			ZAR: 'R'
		};
		const symbol = currency ? symbols[currency] || currency : '₦';
		return `${symbol}${(amount / 100).toFixed(2)}`;
	}

	function formatDate(isoString: string | null): string {
		if (!isoString) return 'Unknown';
		return new Date(isoString).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getStatusColor(status: string | null): string {
		switch (status) {
			case 'success':
				return 'text-green-500';
			case 'initiated':
				return 'text-yellow-500';
			case 'failed':
				return 'text-red-500';
			default:
				return 'text-gray-500';
		}
	}

	function isPaymentStuck(payment: Payment): boolean {
		if (payment.status !== 'initiated' || !payment.createdAt) return false;
		const createdAt = new Date(payment.createdAt);
		const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
		return createdAt < thirtyMinutesAgo;
	}

	async function retryPayment(reference: string) {
		try {
			const response = await fetch('/api/payment/initialize', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${authStore.user?.uid}`
				},
				body: JSON.stringify({ reference })
			});
			if (response.status === 401) {
				// Token expired - show error, don't redirect
				error = 'Session expired. Please login again to retry payment.';
				console.error('Payment retry failed: session expired');
				return;
			}
			if (response.ok) {
				const data = await response.json();
				if (data.authorization_url) {
					window.location.href = data.authorization_url;
				}
			}
		} catch (err) {
			console.error('Failed to retry payment:', err);
			error = 'Failed to retry payment. Please try again.';
		}
	}
</script>

<SeoHead
	title="Subscriptions | ATS Screener"
	description="View your subscription status and payment history."
/>

<main class="subscriptions-page">
	<div class="container">
		<div class="header">
			<h1>Subscriptions</h1>
			<a href="/scanner" class="back-link">← Back to Scanner</a>
		</div>

		{#if loading}
			<div class="loading">Loading subscriptions...</div>
		{:else if error}
			<div class="error">
				<p>{error}</p>
				<button onclick={() => window.location.reload()}>Retry</button>
			</div>
		{:else}
			<div class="subscription-summary">
				<div class="summary-card">
					<h3>Current Plan</h3>
					<p class="plan-type">
						{billingState.subscriptionType === 'monthly'
							? 'Monthly Subscription'
							: billingState.subscriptionType === 'one-time'
								? 'Pay-Per-Use'
								: 'Free Plan'}
					</p>
					{#if billingState.subscriptionType === 'monthly'}
						<p class="plan-details">
							Unlimited reviews until {billingState.subscriptionExpiresAt
								? formatDate(billingState.subscriptionExpiresAt.toISOString())
								: 'N/A'}
						</p>
						<p class="reviews-count">
							Reviews this month: {billingState.reviewsThisMonth}
						</p>
					{:else}
						<p class="credits-display">{billingState.credits} scan credits remaining</p>
						<p class="free-status">
							{billingState.freeUsed ? 'Free credits used' : 'Free credits available'}
						</p>
					{/if}
				</div>
			</div>

			<div class="transactions-list">
				<h2>Payment History</h2>
				{#if payments.length === 0}
					<p class="no-transactions">No payment history found.</p>
				{:else}
					<div class="transaction-items">
						{#each payments as payment}
							<div class="transaction-item">
								<div class="transaction-info">
									<div class="transaction-amount">
										{formatCurrency(payment.amountMinor || 0, payment.currency || 'NGN')}
									</div>
									<div class="transaction-date">
										{formatDate(payment.createdAt || '')}
									</div>
								</div>
								<div class="transaction-details">
									<div class="transaction-status {getStatusColor(payment.status || 'unknown')}">
										{(payment.status || 'unknown').toUpperCase()}
									</div>
									<div class="transaction-ref">Ref: {payment.reference}</div>
									{#if payment.isSubscription}
										<div class="transaction-type">Monthly Subscription</div>
									{:else if payment.scansAllowed}
										<div class="transaction-scans">
											{payment.scansAllowed} scans included
										</div>
									{/if}
									{#if isPaymentStuck(payment)}
										<button class="retry-btn" onclick={() => retryPayment(payment.reference)}>
											Retry Payment
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</main>

<style>
	.subscriptions-page {
		min-height: 100vh;
		padding: 2rem;
		background: var(--bg-primary);
	}

	.container {
		max-width: 800px;
		margin: 0 auto;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2rem;
	}

	.header h1 {
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.back-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s;
	}

	.back-link:hover {
		color: var(--text-primary);
	}

	.loading,
	.error {
		text-align: center;
		padding: 3rem;
		color: var(--text-secondary);
	}

	.error {
		color: var(--text-error);
	}

	.error button {
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		background: var(--gradient-primary);
		color: var(--btn-text);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
	}

	.subscription-summary {
		margin-bottom: 2rem;
	}

	.summary-card {
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		backdrop-filter: blur(20px);
	}

	.summary-card h3 {
		margin: 0 0 0.5rem 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
		font-weight: 500;
	}

	.plan-type {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0.5rem 0;
	}

	.plan-details {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin: 0.5rem 0;
	}

	.credits-display {
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0.5rem 0;
	}

	.reviews-count {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin: 0.5rem 0;
	}

	.free-status {
		color: var(--text-secondary);
		font-size: 0.85rem;
		margin: 0;
	}

	.transactions-list h2 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 1rem;
	}

	.no-transactions {
		color: var(--text-secondary);
		padding: 2rem;
		text-align: center;
		background: var(--glass-bg);
		border-radius: var(--radius-lg);
	}

	.transaction-items {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.transaction-item {
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		padding: 1.25rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		backdrop-filter: blur(20px);
	}

	.transaction-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.transaction-amount {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.transaction-date {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.transaction-details {
		text-align: right;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.transaction-status {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.transaction-ref {
		font-size: 0.8rem;
		color: var(--text-secondary);
		font-family: monospace;
	}

	.transaction-scans,
	.transaction-type {
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}

	.retry-btn {
		margin-top: 0.5rem;
		padding: 0.4rem 0.8rem;
		background: var(--gradient-primary);
		color: var(--btn-text);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.text-green-500 {
		color: #22c55e;
	}

	.text-yellow-500 {
		color: #eab308;
	}

	.text-red-500 {
		color: #ef4444;
	}

	.text-gray-500 {
		color: #6b7280;
	}
</style>
