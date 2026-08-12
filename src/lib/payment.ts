import { authStore } from '$stores/auth.svelte';
import { logger } from '$lib/log';

export interface InitializePaymentResult {
	authorizationUrl: string;
	reference: string;
}

export async function initializePayment(): Promise<InitializePaymentResult> {
	const token = await authStore.getIdToken();
	if (!token) throw new Error('you must be signed in to purchase a review');

	const response = await fetch('/api/payment/initialize', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
	});
	const data = await response.json().catch(() => ({}));
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
		const response = await fetch(`/api/payment/verify?reference=${encodeURIComponent(reference)}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
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
