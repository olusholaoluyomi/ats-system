import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import { logger } from '$lib/log';
import { getPaystackSecret, parseCurrency, parsePriceForCurrency, validatePriceForCurrency } from '$lib/server/paystack';

// Paystack posts the charge result here (server-to-server, no client auth).
// the x-paystack-signature header authenticates the call: HMAC-SHA512 of the
// raw body with the secret key. the body must be verified BEFORE parsing so an
// attacker cannot smuggle a forged payload past the check.
export const POST: RequestHandler = async ({ request }) => {
	const secret = getPaystackSecret(privateEnv);
	if (!secret) {
		// 503 so Paystack keeps retrying until the deploy is configured.
		return json({ error: 'payments are not configured' }, { status: 503 });
	}

	// read raw bytes before any JSON parsing; the signature covers the exact
	// body Paystack sent.
	const rawBody = await request.text();
	const signature = request.headers.get('x-paystack-signature');
	const { verifyWebhookSignature } = await import('$lib/server/paystack');
	if (!verifyWebhookSignature(secret, rawBody, signature)) {
		logger.warn('payment.webhook_bad_signature');
		return json({ error: 'invalid signature' }, { status: 401 });
	}

	let payload: { event?: unknown; data?: Record<string, unknown> };
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return json({ error: 'invalid json' }, { status: 400 });
	}

	// only a successful charge lands a credit. all other events (send, failed,
	// abandoned, webhook ping from Paystack's dashboard) are acknowledged.
	if (payload.event !== 'charge.success') {
		return json({ ok: true });
	}

	const data = payload.data ?? {};
	const reference = typeof data.reference === 'string' ? data.reference : '';
	if (!reference) {
		logger.warn('payment.webhook_missing_reference');
		return json({ ok: true });
	}

	// price + currency are validated here, not inside the credit transaction,
	// so a stale or forged reference can never mint a credit for the wrong
	// amount. a mismatch is logged and acknowledged (200 stops Paystack retries).
	const currency = parseCurrency(privateEnv);
	const price = parsePriceForCurrency(privateEnv, currency);
	try {
		validatePriceForCurrency(price, currency);
	} catch (err) {
		logger.error('payment.bad_price', {
			currency,
			error: err instanceof Error ? err.message : String(err)
		});
		return json({ ok: true });
	}
	if (Number(data.amount) !== price * 100 || data.currency !== currency) {
		logger.warn('payment.webhook_amount_mismatch', {
			reference,
			amount: data.amount,
			currency: data.currency,
			expectedAmount: price * 100,
			expectedCurrency: currency
		});
		return json({ ok: true });
	}

	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) {
			return json({ error: 'billing is not configured' }, { status: 503 });
		}

		// the reference must belong to a real checkout started by /api/payment/initialize.
		const paymentSnap = await db.doc(`payments/${reference}`).get();
		if (!paymentSnap.exists) {
			logger.warn('payment.webhook_unknown_reference', { reference });
			return json({ ok: true });
		}
		const paymentData = paymentSnap.data() as { uid?: unknown; currency?: unknown; amountMinor?: unknown };
		const uid = paymentData?.uid;
		if (typeof uid !== 'string' || uid.length === 0) {
			logger.warn('payment.webhook_reference_missing_uid', { reference });
			return json({ ok: true });
		}

		// Use the currency from the payment record, not the config
		const paymentCurrency = typeof paymentData.currency === 'string' ? paymentData.currency : 'NGN';
		const expectedAmount = typeof paymentData.amountMinor === 'number' ? paymentData.amountMinor : 0;

		// Validate amount matches what we expect
		if (Number(data.amount) !== expectedAmount || data.currency !== paymentCurrency) {
			logger.warn('payment.webhook_amount_mismatch_with_record', {
				reference,
				amount: data.amount,
				currency: data.currency,
				expectedAmount,
				expectedCurrency: paymentCurrency
			});
			return json({ ok: true });
		}

		const { creditReview } = await import('$lib/server/billing');
		const verdict = await creditReview(db, uid, reference, Number(data.amount), paymentCurrency);
		logger.info('payment.credited', { uid, reference, verdict: verdict.status });
	} catch (err) {
		logger.error('payment.webhook_credit_failed', {
			reference,
			error: err instanceof Error ? err.message : String(err)
		});
		// 500 so Paystack retries; the credit transaction is idempotent.
		return json({ error: 'failed to settle payment' }, { status: 500 });
	}

	return json({ ok: true });
};
