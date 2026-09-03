import { authStore } from '$lib/stores/auth.svelte';
import { logger } from '$lib/log';

export interface InitializePaymentResult {
	authorizationUrl: string;
	reference: string;
}

export interface PricingInfo {
	price: number;
	monthlyPrice: number;
	currency: string;
}

// public, unauthenticated: the same price everyone sees, including a visitor
// who hasn't signed in yet. lets the scanner show the real server-configured
// price up front instead of a hardcoded client constant that silently drifts
// once a deploy overrides the PAYSTACK_PRICE_* defaults.
export async function getPricing(): Promise<PricingInfo | null> {
	try {
		const response = await fetch('/api/pricing');
		if (!response.ok) return null;
		const data = await response.json();
		if (
			typeof data.price !== 'number' ||
			typeof data.monthlyPrice !== 'number' ||
			typeof data.currency !== 'string'
		) {
			return null;
		}
		return { price: data.price, monthlyPrice: data.monthlyPrice, currency: data.currency };
	} catch (err) {
		logger.warn('pricing.fetch_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		return null;
	}
}

export async function initializePayment(
	paymentType: 'one-time' | 'monthly' = 'one-time'
): Promise<InitializePaymentResult> {
	const token = await authStore.getIdToken();
	if (!token) throw new Error('you must be signed in to purchase a review');

	const response = await fetch('/api/payment/initialize', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ payment_type: paymentType })
	});
	const data = await response.json().catch(() => ({}));

	// If we get a 401 (unauthorized), try refreshing the token and retry once
	if (response.status === 401) {
		logger.info('payment.token_expired_refreshing');
		const freshToken = await authStore.getIdToken(true); // force refresh
		if (!freshToken) throw new Error('failed to refresh authentication token');

		const retryResponse = await fetch('/api/payment/initialize', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${freshToken}`
			},
			body: JSON.stringify({ payment_type: paymentType })
		});
		const retryData = await retryResponse.json().catch(() => ({}));

		if (!retryResponse.ok) {
			throw new Error((retryData.error as string) ?? 'failed to start payment');
		}
		if (
			typeof retryData.authorization_url !== 'string' ||
			retryData.authorization_url.length === 0
		) {
			throw new Error('payment provider returned no checkout link');
		}
		return {
			authorizationUrl: retryData.authorization_url as string,
			reference: typeof retryData.reference === 'string' ? retryData.reference : ''
		};
	}

	if (!response.ok) {
		throw new Error((data.error as string) ?? 'failed to start payment');
	}
	if (typeof data.authorization_url !== 'string' || data.authorization_url.length === 0) {
		throw new Error('payment provider returned no checkout link');
	}
	return {
		authorizationUrl: data.authorization_url as string,
		reference: typeof data.reference === 'string' ? data.reference : ''
	};
}

export async function verifyPayment(reference: string): Promise<boolean> {
	const token = await authStore.getIdToken();
	if (!token) return false;

	try {
		let response = await fetch(`/api/payment/verify?reference=${encodeURIComponent(reference)}`, {
			headers: { Authorization: `Bearer ${token}` }
		});

		// a stale cached ID token can 401 even though the session is still good
		// (same class of failure as initializePayment above) - force a fresh
		// token and retry once before reporting the payment as unverified.
		if (response.status === 401) {
			logger.info('payment.verify_token_expired_refreshing');
			const freshToken = await authStore.getIdToken(true);
			if (freshToken) {
				response = await fetch(
					`/api/payment/verify?reference=${encodeURIComponent(reference)}`,
					{ headers: { Authorization: `Bearer ${freshToken}` } }
				);
			}
		}

		const data = await response.json().catch(() => ({}));
		if (response.ok && data.success === true) return true;
		logger.warn('payment.verify_client_failed', {
			reference,
			status: response.status,
			error: data.error ?? 'unknown'
		});
		return false;
	} catch (err) {
		logger.warn('payment.verify_client_error', {
			reference,
			error: err instanceof Error ? err.message : String(err)
		});
		return false;
	}
}

export async function getPaymentHistory() {
	const token = await authStore.getIdToken();
	if (!token) return { ok: false, error: 'not-authenticated' };
	const res = await fetch('/api/payment/history', {
		headers: { Authorization: `Bearer ${token}` }
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) return { ok: false, error: json.error ?? 'failed' };
	return { ok: true, payments: json.payments ?? [] };
}
