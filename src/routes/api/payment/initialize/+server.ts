import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { randomUUID } from 'node:crypto';
import { logger } from '$lib/log';
import { resolveAuthMode } from '$lib/server/auth/config';
import {
	getPaystackSecret,
	initializePaystack,
	parseCurrency,
	parsePriceForCurrency,
	validatePriceForCurrency
} from '$lib/server/paystack';
import { SCANS_PER_PAYMENT } from '$lib/server/billing-config';

// payments only exist in firebase mode (the hosted paid-review model). ldap
// self-host and anonymous 'none' mode have no concept of a wallet, so the
// endpoint is inert there.
export const POST: RequestHandler = async ({ request }) => {
	// resolve the mode from private + public env: PUBLIC_FIREBASE_PROJECT_ID only
	// reaches the server through $env/dynamic/public (PUBLIC_ vars are stripped
	// from the private module), same merge as hooks.server.ts.
	if (resolveAuthMode({ ...privateEnv, ...publicEnv }) !== 'firebase') {
		return json({ error: 'payments are only available in firebase mode' }, { status: 400 });
	}

	// the caller must be a real signed-in firebase user; their uid is bound to
	// the payment record so verify/webhook can never credit a stranger.
	const { verifyFirebaseIdToken } = await import('$lib/server/auth/token');
	const identity = await verifyFirebaseIdToken(privateEnv, request.headers.get('authorization'));
	if (!identity) {
		return json({ error: 'authentication required' }, { status: 401 });
	}

	const secret = getPaystackSecret(privateEnv);
	if (!secret) {
		return json({ error: 'payments are not configured on this deploy' }, { status: 503 });
	}

	const currency = parseCurrency(privateEnv);
	const price = parsePriceForCurrency(privateEnv, currency);
	try {
		validatePriceForCurrency(price, currency);
	} catch (err) {
		logger.error('payment.bad_price', {
			currency,
			error: err instanceof Error ? err.message : String(err)
		});
		return json({ error: 'payments are misconfigured on this deploy' }, { status: 503 });
	}
	const amountMinor = currency === 'NGN' ? price * 100 : price * 100; // Paystack uses minor units

	const reference = `ats_${identity.uid.slice(0, 10)}_${randomUUID()}`;
	const origin = new URL(request.url).origin;
	const callbackUrl = `${origin}/payment/callback`;
	const cancelUrl = `${origin}/scanner`;

	// record the intent BEFORE redirecting so the webhook (which can fire while
	// the user is still on Paystack's page) finds a payments/{reference} doc
	// with the correct uid + amount to credit.
	try {
		const { getAdminFirestore } = await import('$lib/server/firebase-admin');
		const db = await getAdminFirestore(privateEnv);
		if (!db) {
			return json({ error: 'billing is not configured on this deploy' }, { status: 503 });
		}
		await db.doc(`payments/${reference}`).set({
			uid: identity.uid,
			email: identity.email ?? null,
			reference,
			amountMinor,
			currency,
			status: 'initiated',
			createdAt: new Date(),
			updatedAt: new Date(),
			scansAllowed: SCANS_PER_PAYMENT
		});
	} catch (err) {
		logger.error('payment.intent_write_failed', {
			uid: identity.uid,
			error: err instanceof Error ? err.message : String(err)
		});
		return json({ error: 'failed to start a payment session' }, { status: 500 });
	}

	let init;
	try {
		init = await initializePaystack(privateEnv, {
			email: identity.email ?? `${identity.uid}@users.local`,
			reference,
			amountKobo: amountMinor,
			currency,
			callbackUrl,
			cancelUrl
		});
	} catch (err) {
		logger.error('payment.initialize_failed', {
			uid: identity.uid,
			error: err instanceof Error ? err.message : String(err)
		});
		return json({ error: 'payment provider is unavailable' }, { status: 502 });
	}

	return json({ authorization_url: init.authorization_url, reference });
};
