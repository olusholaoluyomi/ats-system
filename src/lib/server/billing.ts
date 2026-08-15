import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { SCANS_PER_PAYMENT, MONTHLY_SUBSCRIPTION_DAYS } from './billing-config';

export type SubscriptionType = 'free' | 'one-time' | 'monthly';

export interface BillingDoc {
	freeUsed?: boolean;
	credits?: number;
	subscriptionType?: SubscriptionType;
	subscriptionExpiresAt?: Date | string;
	reviewsThisMonth?: number;
	[key: string]: unknown;
}

export interface NormalizedBilling {
	freeUsed: boolean;
	credits: number;
	subscriptionType: SubscriptionType;
	subscriptionExpiresAt?: Date;
	reviewsThisMonth: number;
}

export const DEFAULT_BILLING: NormalizedBilling = {
	freeUsed: true,
	credits: 4,
	subscriptionType: 'free',
	reviewsThisMonth: 0
};

export const BILLING_DOC = 'state';

export type ReviewUsed = 'free' | 'credit' | 'subscription';

export type ConsumeVerdict = { status: 'ok'; used: ReviewUsed } | { status: 'blocked' };

interface BillingLike {
	freeUsed?: unknown;
	credits?: unknown;
	subscriptionType?: unknown;
	subscriptionExpiresAt?: unknown;
	reviewsThisMonth?: unknown;
}

export function evaluateBilling(billing: BillingLike | null | undefined): ReviewUsed | 'none' {
	if (billing == null) return 'free'; // brand-new account, no doc yet → 4 gifted credits
	// If credits field is missing/undefined, treat as new account with 4 gifted credits
	if (billing.credits === undefined) return 'free';
	if (typeof billing.credits !== 'number') return 'none';

	const subscriptionType = billing.subscriptionType as SubscriptionType;
	const subscriptionExpiresAt = billing.subscriptionExpiresAt;

	// Check if monthly subscription is active
	if (subscriptionType === 'monthly' && subscriptionExpiresAt) {
		const expiresAt =
			typeof subscriptionExpiresAt === 'string'
				? new Date(subscriptionExpiresAt)
				: subscriptionExpiresAt;
		if (expiresAt > new Date()) {
			return 'subscription'; // Unlimited reviews
		}
	}

	const freeUsed = billing.freeUsed === true;
	if (!freeUsed) return 'free';
	if (billing.credits > 0) return 'free';
	return 'none';
}

function toBillingDoc(raw: unknown): NormalizedBilling {
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_BILLING };
	const rec = raw as BillingDoc;
	return {
		freeUsed: rec.freeUsed === true,
		credits: typeof rec.credits === 'number' ? rec.credits : 0,
		subscriptionType: (rec.subscriptionType as SubscriptionType) || 'free',
		subscriptionExpiresAt:
			rec.subscriptionExpiresAt && typeof rec.subscriptionExpiresAt === 'string'
				? new Date(rec.subscriptionExpiresAt)
				: rec.subscriptionExpiresAt instanceof Date
					? rec.subscriptionExpiresAt
					: undefined,
		reviewsThisMonth: typeof rec.reviewsThisMonth === 'number' ? rec.reviewsThisMonth : 0
	};
}

// atomically claims one review. free first, then paid credits, then subscription.
export async function consumeReview(db: Firestore, uid: string): Promise<ConsumeVerdict> {
	const billingRef = db.doc(`users/${uid}/billing/${BILLING_DOC}`);
	return db.runTransaction(async (tx: Transaction) => {
		const snap = await tx.get(billingRef);
		const billing = toBillingDoc(snap.exists ? snap.data() : undefined);
		const used = evaluateBilling(billing);
		if (used === 'free') {
			tx.set(billingRef, {
				freeUsed: true,
				credits: billing.credits - 1,
				subscriptionType: billing.subscriptionType,
				subscriptionExpiresAt: billing.subscriptionExpiresAt,
				reviewsThisMonth: billing.reviewsThisMonth,
				updatedAt: new Date()
			});
			return { status: 'ok', used };
		}
		if (used === 'credit') {
			// Simply decrement the total credits counter
			tx.set(billingRef, {
				freeUsed: true,
				credits: billing.credits - 1,
				subscriptionType: billing.subscriptionType,
				subscriptionExpiresAt: billing.subscriptionExpiresAt,
				reviewsThisMonth: billing.reviewsThisMonth,
				updatedAt: new Date()
			});
			return { status: 'ok', used };
		}
		if (used === 'subscription') {
			// Increment monthly review counter for tracking
			tx.set(billingRef, {
				freeUsed: true,
				credits: billing.credits,
				subscriptionType: 'monthly',
				subscriptionExpiresAt: billing.subscriptionExpiresAt,
				reviewsThisMonth: billing.reviewsThisMonth + 1,
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
			// Restore the credit that was consumed from the free allocation
			tx.set(billingRef, {
				freeUsed: false,
				credits: billing.credits + 1,
				subscriptionType: billing.subscriptionType,
				subscriptionExpiresAt: billing.subscriptionExpiresAt,
				reviewsThisMonth: billing.reviewsThisMonth,
				updatedAt: new Date()
			});
		} else if (used === 'subscription') {
			// Decrement monthly review counter
			tx.set(billingRef, {
				freeUsed: true,
				credits: billing.credits,
				subscriptionType: 'monthly',
				subscriptionExpiresAt: billing.subscriptionExpiresAt,
				reviewsThisMonth: Math.max(0, billing.reviewsThisMonth - 1),
				updatedAt: new Date()
			});
		} else {
			// Simply increment the total credits counter
			tx.set(billingRef, {
				freeUsed: true,
				credits: billing.credits + 1,
				subscriptionType: billing.subscriptionType,
				subscriptionExpiresAt: billing.subscriptionExpiresAt,
				reviewsThisMonth: billing.reviewsThisMonth,
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
	currency: string,
	isSubscription = false
): Promise<CreditVerdict> {
	const paymentRef = db.doc(`payments/${reference}`);
	const billingRef = db.doc(`users/${uid}/billing/${BILLING_DOC}`);
	return db.runTransaction(async (tx: Transaction) => {
		const paySnap = await tx.get(paymentRef);
		const billSnap = await tx.get(billingRef);

		if (paySnap.exists) {
			const payData = paySnap.data() as {
				status?: string;
				uid?: string;
				amountMinor?: number;
			};
			if (payData?.status === 'success') return { status: 'noop' };
			if (payData?.uid && payData.uid !== uid) return { status: 'noop' };
			if (payData?.amountMinor !== undefined && payData.amountMinor !== amountMinor) {
				return { status: 'noop' };
			}
		}

		const billing = toBillingDoc(billSnap.exists ? billSnap.data() : undefined);

		if (isSubscription) {
			// Monthly subscription: set unlimited access
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + MONTHLY_SUBSCRIPTION_DAYS);

			tx.set(
				paymentRef,
				{
					uid,
					reference,
					amountMinor,
					currency,
					status: 'success',
					isSubscription: true,
					subscriptionExpiresAt: expiresAt,
					updatedAt: new Date()
				},
				{ merge: true }
			);

			tx.set(billingRef, {
				freeUsed: true,
				credits: billing.credits,
				subscriptionType: 'monthly',
				subscriptionExpiresAt: expiresAt,
				reviewsThisMonth: 0,
				updatedAt: new Date()
			});
		} else {
			// One-time payment: add 4 scan credits
			tx.set(
				paymentRef,
				{
					uid,
					reference,
					amountMinor,
					currency,
					status: 'success',
					scansAllowed: SCANS_PER_PAYMENT,
					isSubscription: false,
					updatedAt: new Date()
				},
				{ merge: true }
			);

			tx.set(billingRef, {
				freeUsed: billing.freeUsed === true,
				credits: billing.credits + SCANS_PER_PAYMENT,
				subscriptionType: billing.subscriptionType || 'one-time',
				subscriptionExpiresAt: billing.subscriptionExpiresAt,
				reviewsThisMonth: billing.reviewsThisMonth,
				updatedAt: new Date()
			});
		}

		return { status: 'credited' };
	});
}
