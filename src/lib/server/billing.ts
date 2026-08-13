import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { PLANS, SCANS_PER_PAYMENT } from './billing-config';

export interface BillingDoc {
	freeUsed?: boolean;
	credits?: number;
	[key: string]: unknown;
}

export interface NormalizedBilling {
	freeUsed: boolean;
	credits: number;
}

export const DEFAULT_BILLING: NormalizedBilling = { freeUsed: true, credits: 4 };

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
	if (credits > 0) return 'free';
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

// atomically claims one review. free first, then paid credits.
// Simplified logic: billing.credits is the single source of truth for total available scans.
// Each payment adds SCANS_PER_PAYMENT credits, each scan consumes 1 credit.
export async function consumeReview(db: Firestore, uid: string): Promise<ConsumeVerdict> {
	const billingRef = db.doc(`users/${uid}/billing/${BILLING_DOC}`);
	return db.runTransaction(async (tx: Transaction) => {
		const snap = await tx.get(billingRef);
		const billing = toBillingDoc(snap.exists ? snap.data() : undefined);
		const used = evaluateBilling(billing);
		if (used === 'free') {
			tx.set(billingRef, { freeUsed: true, credits: billing.credits - 1, updatedAt: new Date() });
			return { status: 'ok', used };
		}
		if (used === 'credit') {
			// Simply decrement the total credits counter
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
			// Simply increment the total credits counter
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
export async function creditReview(
	db: Firestore,
	uid: string,
	reference: string,
	amountMinor: number,
	currency: string
): Promise<CreditVerdict> {
	const paymentRef = db.doc(`payments/${reference}`);
	const billingRef = db.doc(`users/${uid}/billing/${BILLING_DOC}`);
	return db.runTransaction(async (tx: Transaction) => {
		const paySnap = await tx.get(paymentRef);
		const billSnap = await tx.get(billingRef);

		if (paySnap.exists) {
			const payData = paySnap.data() as { status?: string; uid?: string; amountMinor?: number };
			if (payData?.status === 'success') return { status: 'noop' };
			if (payData?.uid && payData.uid !== uid) return { status: 'noop' };
			if (payData?.amountMinor !== undefined && payData.amountMinor !== amountMinor) {
				return { status: 'noop' };
			}
		}

		const billing = toBillingDoc(billSnap.exists ? billSnap.data() : undefined);
		// set payment success and record how many scans this payment allows
		tx.set(
			paymentRef,
			{
				uid,
				reference,
				amountMinor,
				currency,
				status: 'success',
				scansAllowed: SCANS_PER_PAYMENT,
				updatedAt: new Date()
			},
			{ merge: true }
		);

		// Add the credits to the user's total balance
		tx.set(billingRef, {
			freeUsed: billing.freeUsed === true,
			credits: billing.credits + SCANS_PER_PAYMENT,
			updatedAt: new Date()
		});

		return { status: 'credited' };
	});
}
