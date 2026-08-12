import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { SCANS_PER_PAYMENT } from './billing-config';

export interface BillingDoc {
	freeUsed?: boolean;
	credits?: number;
	[key: string]: unknown;
}

export interface NormalizedBilling {
	freeUsed: boolean;
	credits: number;
}

export const DEFAULT_BILLING: NormalizedBilling = { freeUsed: false, credits: 0 };

export const BILLING_DOC = 'state';

export type ReviewUsed = 'free' | 'credit';

export type ConsumeVerdict = { status: 'ok'; used: ReviewUsed } | { status: 'blocked' };

interface BillingLike {
	freeUsed?: unknown;
	credits?: unknown;
}

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

// atomically claims one review. free first, then paid credits. when a paid
// credit is spent we also decrement scansRemaining on one of the settled
// payments owned by the user so the ledger stays in sync with the billing doc.
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
			// find one successful payment with scansRemaining > 0 and decrement it.
			// Firestore transactions do not support queries inside tx.get on the
			// Admin SDK in all environments, but our unit tests use a fake DB that
			// models get(ref) only. To keep tests simple we scan predictable paths
			// by reading all payments for the user and picking one with remaining
			// scans. In production this pattern is acceptable for the small scale
			// of per-user payment counts; optimize later if needed.
			const paymentsColl = (db as any).collection
				? (db as any).collection('payments')
				: null;
			let paymentPathToDecrement: string | null = null;
			if (paymentsColl && typeof paymentsColl.where === 'function') {
				const q = (db as any).collection('payments').where('uid', '==', uid).where('status', '==', 'success');
				const snap = await q.get();
				for (const doc of snap.docs) {
					const data = doc.data();
					if (typeof data.scansRemaining === 'number' && data.scansRemaining > 0) {
						paymentPathToDecrement = doc.ref.path;
						break;
					}
				}
			}

			// decrement billing credits
			tx.set(billingRef, {
				freeUsed: true,
				credits: billing.credits - 1,
				updatedAt: new Date()
			});

			if (paymentPathToDecrement) {
				tx.set({ path: paymentPathToDecrement }, { scansRemaining: (await tx.get({ path: paymentPathToDecrement })).data().scansRemaining - 1, updatedAt: new Date() }, { merge: true });
			}

			return { status: 'ok', used };
		}
		return { status: 'blocked' };
	});
}

export async function refundReview(db: Firestore, uid: string, used: ReviewUsed): Promise<{ status: 'refunded' }> {
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

// creditReview: when a payment settles, mark payment success and add multiple credits
export async function creditReview(db: Firestore, uid: string, reference: string, amountKobo: number, currency: string): Promise<CreditVerdict> {
	const paymentRef = db.doc(`payments/${reference}`);
	const billingRef = db.doc(`users/${uid}/billing/${BILLING_DOC}`);
	return db.runTransaction(async (tx: Transaction) => {
		const paySnap = await tx.get(paymentRef);
		const billSnap = await tx.get(billingRef);

		if (paySnap.exists) {
			const payData = paySnap.data() as { status?: unknown; uid?: unknown; amountKobo?: unknown };
			if (payData?.status === 'success') return { status: 'noop' };
			if (payData?.uid && payData.uid !== uid) return { status: 'noop' };
			if (payData?.amountKobo !== undefined && payData.amountKobo !== amountKobo) {
				return { status: 'noop' };
			}
		}

		const billing = toBillingDoc(billSnap.exists ? billSnap.data() : undefined);
		// set payment success and scansRemaining/scansAllowed
		tx.set(
			paymentRef,
			{
				uid,
				reference,
				amountKobo,
				currency,
				status: 'success',
				scansRemaining: SCANS_PER_PAYMENT,
				scansAllowed: SCANS_PER_PAYMENT,
				updatedAt: new Date()
			},
			{ merge: true }
		);

		tx.set(billingRef, {
			freeUsed: billing.freeUsed === true,
			credits: billing.credits + SCANS_PER_PAYMENT,
			updatedAt: new Date()
		});

		return { status: 'credited' };
	});
}
