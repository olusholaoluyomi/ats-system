// atomic billing for resume reviews. the rule is simple: the first full-score
// review per Firebase account is free, every subsequent one costs one paid
// credit. enforcement happens in a single Firestore transaction per review so
// concurrent scans cannot double-claim the free review (two double-clicks that
// both pass the gate serialize on the billing doc: the loser sees freeUsed=true
// and no credits and comes back 'blocked').
//
// state lives in two collections, both server-writable only (see firestore.rules):
//   users/{uid}/billing/state - the billing document ({ freeUsed, credits }),
//                               a fixed subdocument of the per-user billing
//                               collection (users/{uid}/billing is a collection
//                               path, so the doc itself lives one level deeper)
//   payments/{reference} - the ledger for a single checkout (initiated/success),
//                          written by the payment routes and read by the webhook
//
// purely functional on top of a Firestore-like handle (doc/runTransaction) so it
// unit-tests against an in-memory fake without touching firebase-admin.
import type { Firestore, Transaction } from 'firebase-admin/firestore';

export interface BillingDoc {
	freeUsed?: boolean;
	credits?: number;
	[key: string]: unknown;
}

// normalized view of a billing doc: fields defaulted and coerced to their real
// types. firestore doc shapes are untrusted, so every read passes through
// toBillingDoc before any arithmetic touches `credits`.
export interface NormalizedBilling {
	freeUsed: boolean;
	credits: number;
}

export const DEFAULT_BILLING: NormalizedBilling = { freeUsed: false, credits: 0 };

export const BILLING_DOC = 'state';

export type ReviewUsed = 'free' | 'credit';

export type ConsumeVerdict = { status: 'ok'; used: ReviewUsed } | { status: 'blocked' };

// minimal structural view for pure decisions: both normalized billing docs and
// untrusted firestore doc shapes satisfy this, so evaluateBilling stays usable
// on either without an index-signature fight.
interface BillingLike {
	freeUsed?: unknown;
	credits?: unknown;
}

// pure decision helper: which entitlement does this billing doc grant next?
export function evaluateBilling(billing: BillingLike | null | undefined): ReviewUsed | 'none' {
	const freeUsed = billing?.freeUsed === true;
	const credits = typeof billing?.credits === 'number' ? billing.credits : 0;
	if (!freeUsed) return 'free';
	if (credits > 0) return 'credit';
	return 'none';
}

function toBillingDoc(raw: unknown): NormalizedBilling {
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_BILLING };
	const rec = raw as BillingDoc;
	return {
		freeUsed: rec.freeUsed === true,
		credits: typeof rec.credits === 'number' ? rec.credits : 0
	};
}

// atomically claims one review (the free one first, then a paid credit).
// returns { ok, used } when entitled, { blocked } when the account is dry.
// idempotency is NOT required here: every full-score call that gets an 'ok'
// MUST be matched by exactly one refund or one successful analysis, otherwise
// credits leak. see consumeAndRefund below.
export async function consumeReview(db: Firestore, uid: string): Promise<ConsumeVerdict> {
	const billingRef = db.doc(`users/${uid}/billing/${BILLING_DOC}`);
	return db.runTransaction(async (tx: Transaction) => {
		const snap = await tx.get(billingRef);
		const billing = toBillingDoc(snap.exists ? snap.data() : undefined);
		const used = evaluateBilling(billing);
		if (used === 'free') {
			tx.set(billingRef, { freeUsed: true, credits: billing.credits, updatedAt: new Date() });
			return { status: 'ok', used };
		}
		if (used === 'credit') {
			tx.set(billingRef, {
				freeUsed: true,
				credits: billing.credits - 1,
				updatedAt: new Date()
			});
			return { status: 'ok', used };
		}
		return { status: 'blocked' };
	});
}

// gives a consumed review back (credit restored, or freeUsed reset). called
// when a scan turns out to have produced no result (cache hit / total LLM
// failure) so an outage or a retried identical scan never bills the user.
export async function refundReview(
	db: Firestore,
	uid: string,
	used: ReviewUsed
): Promise<{ status: 'refunded' }> {
	const billingRef = db.doc(`users/${uid}/billing/${BILLING_DOC}`);
	return db.runTransaction(async (tx: Transaction) => {
		const snap = await tx.get(billingRef);
		const billing = toBillingDoc(snap.exists ? snap.data() : undefined);
		if (used === 'free') {
			tx.set(billingRef, { freeUsed: false, credits: billing.credits, updatedAt: new Date() });
		} else {
			tx.set(billingRef, {
				freeUsed: true,
				credits: billing.credits + 1,
				updatedAt: new Date()
			});
		}
		return { status: 'refunded' };
	});
}

export type CreditVerdict = { status: 'credited' } | { status: 'noop' };

// atomically records a settled payment and adds one credit. idempotent: the
// webhook (Paystack → server) and the client's verify-after-redirect can both
// race on the same reference, and exactly one of them lands the credit. the
// payments/{reference} doc is the lock: once its status is 'success' the
// credit has already been granted and this becomes a no-op. also refuses to
// credit a reference that belongs to someone else or was initialized for a
// different amount (both return a no-op verdict without writing anything).
export async function creditReview(
	db: Firestore,
	uid: string,
	reference: string,
	amountKobo: number,
	currency: string
): Promise<CreditVerdict> {
	const paymentRef = db.doc(`payments/${reference}`);
	const billingRef = db.doc(`users/${uid}/billing/${BILLING_DOC}`);
	return db.runTransaction(async (tx: Transaction) => {
		const paySnap = await tx.get(paymentRef);
		const billSnap = await tx.get(billingRef);

		if (paySnap.exists) {
			const payData = paySnap.data() as {
				status?: unknown;
				uid?: unknown;
				amountKobo?: unknown;
			};
			// already settled by a racing webhook/verify call. the billing
			// increment committed in the same transaction as this status flip,
			// so no re-credit is needed.
			if (payData?.status === 'success') return { status: 'noop' };
			// guard rails: never credit a reference that belongs to someone else
			// or was initialized for a different price.
			if (payData?.uid && payData.uid !== uid) return { status: 'noop' };
			if (payData?.amountKobo !== undefined && payData.amountKobo !== amountKobo) {
				return { status: 'noop' };
			}
		}

		const billing = toBillingDoc(billSnap.exists ? billSnap.data() : undefined);
		tx.set(
			paymentRef,
			{
				uid,
				reference,
				amountKobo,
				currency,
				status: 'success',
				updatedAt: new Date()
			},
			{ merge: true }
		);
		tx.set(billingRef, {
			freeUsed: billing.freeUsed === true,
			credits: billing.credits + 1,
			updatedAt: new Date()
		});
		return { status: 'credited' };
	});
}
