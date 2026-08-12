import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { logger } from '$lib/log';
import { resolveAuthMode } from '$lib/server/auth/config';
import { getPaystackSecret, verifyPaystack, CURRENCY } from '$lib/server/paystack';

// the user lands on /payment/callback?reference=... after Paystack redirects
// them back; this endpoint settles the charge by asking Paystack (server-side)
// whether it really succeeded. separate from the webhook so the user's browser
// gets a definitive answer even if Paystack's webhook is late or the deploy
// was briefly down. creditReview is idempotent, so webhook + verify can both
// fire on the same reference and exactly one lands the credit.
export const GET: RequestHandler = async ({ request, url }) => {
  // same public/private env merge as hooks.server.ts: PUBLIC_FIREBASE_PROJECT_ID
  // is not visible through $env/dynamic/private alone.
  if (resolveAuthMode({ ...privateEnv, ...publicEnv }) !== 'firebase') {
    return json({ error: 'payments are only available in firebase mode' }, { status: 400 });
  }

  const reference = url.searchParams.get('reference');
  if (!reference) {
    return json({ error: 'missing reference' }, { status: 400 });
  }

  const { verifyFirebaseIdToken } = await import('$lib/server/auth/token');
  const identity = await verifyFirebaseIdToken(privateEnv, request.headers.get('authorization'));
  if (!identity) {
    return json({ error: 'authentication required' }, { status: 401 });
  }

  const secret = getPaystackSecret(privateEnv);
  if (!secret) {
    return json({ error: 'payments are not configured on this deploy' }, { status: 503 });
  }

  try {
    const { getAdminFirestore } = await import('$lib/server/firebase-admin');
    const db = await getAdminFirestore(privateEnv);
    if (!db) {
      return json({ error: 'billing is not configured on this deploy' }, { status: 503 });
    }

    const paymentRef = db.doc(`payments/${reference}`);
    const paymentSnap = await paymentRef.get();
    if (!paymentSnap.exists) {
      return json({ error: 'unknown payment reference' }, { status: 404 });
    }
    const payment = paymentSnap.data() as {
      uid?: unknown;
      amountKobo?: unknown;
      currency?: unknown;
      status?: unknown;
    };

    // a user may only settle their OWN checkout; someone else's reference
    // must not credit this account (and must not leak its existence).
    if (payment.uid !== identity.uid) {
      return json({ error: 'this payment does not belong to your account' }, { status: 403 });
    }

    // already settled (webhook won the race): report success without another
    // credit. creditReview below is idempotent anyway, this just short-circuits
    // the Paystack round-trip.
    if (payment.status === 'success') {
      return json({ success: true, reference });
    }

    const expectedKobo = typeof payment.amountKobo === 'number' ? payment.amountKobo : 0;
    const verification = await verifyPaystack(privateEnv, reference);
    if (!verification || !verification.paid) {
      // not paid yet / not confirmable. the webhook will settle it when
      // Paystack confirms; the callback page can tell the user to check back.
      return json({ success: false, status: verification?.status ?? 'unknown' });
    }

    // a settled charge for a different amount/currency than we initialized is
    // either a config change mid-flight or a forged response — never credit it.
    if (verification.amountKobo !== expectedKobo || verification.currency !== CURRENCY) {
      logger.warn('payment.verify_amount_mismatch', {
        reference,
        uid: identity.uid,
        chargedKobo: verification.amountKobo,
        chargedCurrency: verification.currency,
        expectedKobo
      });
      return json({ success: false, status: 'amount_mismatch' });
    }

    const { creditReview } = await import('$lib/server/billing');
    const verdict = await creditReview(db, identity.uid, reference, verification.amountKobo, CURRENCY);
    logger.info('payment.verified', { uid: identity.uid, reference, verdict: verdict.status });
    return json({ success: true, reference });
  } catch (err) {
    logger.error('payment.verify_failed', {
      reference,
      uid: identity.uid,
      error: err instanceof Error ? err.message : String(err)
    });
    return json({ error: 'failed to verify payment' }, { status: 500 });
  }
};
