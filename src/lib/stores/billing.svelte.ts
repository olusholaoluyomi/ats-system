// per-account review entitlements for the pay-per-review model. reads the
// server-managed users/{uid}/billing doc (client-readable, never client-
// writable - see firestore.rules) so the UI can show whether a scan is free,
// needs a paid credit, or is paywalled. payment initiation/verification go
// through the /api/payment routes (see $lib/payment.ts); this store only
// mirrors the resulting state.
import { browser } from '$app/environment';
import { getFirebase } from '$lib/firebase';
import { logger } from '$lib/log';
import { authStore } from './auth.svelte';

class BillingStore {
	freeUsed = $state(false);
	credits = $state(4);
	subscriptionType = $state<'free' | 'one-time' | 'monthly'>('free');
	subscriptionExpiresAt = $state<Date | null>(null);
	loading = $state(true);
	error = $state<string | null>(null);

	// payments only exist in firebase mode; ldap/none have no wallet concept.
	get enabled(): boolean {
		return authStore.mode === 'firebase';
	}

	// whether the current account can run a review right now (free or paid).
	get canReview(): boolean {
		// Monthly subscribers can always review
		if (this.subscriptionType === 'monthly' && this.subscriptionExpiresAt) {
			return this.subscriptionExpiresAt > new Date();
		}
		// Free tier or one-time: check credits
		return !this.freeUsed || this.credits > 0;
	}

	// pull the latest billing doc. safe to call whenever auth state settles
	// (sign-in, sign-out, after a payment callback); no-ops off the right path
	// and resets to the "brand new account" state on sign-out so a later user
	// of the same browser never inherits the previous account's entitlements.
	async refresh() {
		if (!browser || !this.enabled) {
			this.loading = false;
			return;
		}
		if (!authStore.isAuthenticated || !authStore.user) {
			this.freeUsed = false;
			this.credits = 4;
			this.subscriptionType = 'free';
			this.subscriptionExpiresAt = null;
			this.loading = false;
			return;
		}
		this.loading = true;
		try {
			const { db } = await getFirebase();
			const { getDoc, doc } = await import('firebase/firestore');
			// users/{uid}/billing is a collection path; the entitlements doc is
			// the fixed 'state' subdocument (mirrors the server's billing module).
			const snap = await getDoc(doc(db, 'users', authStore.user.uid, 'billing', 'state'));
			const data = snap.exists() ? snap.data() : {};
			this.freeUsed = data.freeUsed === true;
			this.credits = typeof data.credits === 'number' ? data.credits : 4;
			this.subscriptionType = (data.subscriptionType as 'free' | 'one-time' | 'monthly') || 'free';
			this.subscriptionExpiresAt =
				data.subscriptionExpiresAt && typeof data.subscriptionExpiresAt === 'string'
					? new Date(data.subscriptionExpiresAt)
					: data.subscriptionExpiresAt instanceof Date
						? data.subscriptionExpiresAt
						: null;
			this.error = null;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'failed to load billing';
			logger.warn('billing.load_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
		} finally {
			this.loading = false;
		}
	}

	// starts a checkout and returns the Paystack authorization URL to redirect to.
	async payForReview(paymentType: 'one-time' | 'monthly' = 'one-time'): Promise<string> {
		const { initializePayment } = await import('$lib/payment');
		const { authorizationUrl } = await initializePayment(paymentType);
		return authorizationUrl;
	}
}

export const billingStore = new BillingStore();
