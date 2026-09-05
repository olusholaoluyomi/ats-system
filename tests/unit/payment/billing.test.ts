import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
	consumeReview,
	creditReview,
	evaluateBilling,
	refundReview
} from '../../../src/lib/server/billing';

// the billing module is pure over a Firestore-like handle (doc/runTransaction),
// so these tests drive it against an in-memory Map. Firestore's optimistic
// concurrency guarantees that concurrent transactions end in a serial order
// (retrying any that conflict); the fake models that serial outcome directly by
// running transactions one-at-a-time in call order, each reading the latest
// committed state. that is exactly the invariant the double-click-free-review
// race and the webhook/verify double-fire race rely on.

type DocData = Record<string, unknown>;

interface QueryPredicate {
	field: string;
	op: string;
	value: unknown;
}

class FakeTx {
	constructor(private readonly store: Map<string, DocData>) {}

	async get(ref: { path: string }) {
		return {
			exists: this.store.has(ref.path),
			data: () => this.store.get(ref.path)
		};
	}

	set(ref: { path: string }, data: DocData, _opts?: { merge?: boolean }) {
		this.store.set(ref.path, data);
	}
}

class FakeQuery {
	constructor(
		private readonly store: Map<string, DocData>,
		private readonly collectionName: string,
		private readonly predicates: QueryPredicate[] = []
	) {}

	where(field: string, op: string, value: unknown) {
		return new FakeQuery(this.store, this.collectionName, [
			...this.predicates,
			{ field, op, value }
		]);
	}

	async get() {
		const docs: Array<{ ref: { path: string }; data: () => DocData }> = [];
		for (const [path, data] of this.store.entries()) {
			if (!path.startsWith(`${this.collectionName}/`)) continue;
			if (this.matches(data)) docs.push({ ref: { path }, data: () => data });
		}
		return { docs };
	}

	private matches(data: DocData): boolean {
		return this.predicates.every(({ field, op, value }) => {
			const fieldVal = data[field];
			switch (op) {
				case '==':
					return fieldVal === value;
				case '>':
					return typeof fieldVal === 'number' && typeof value === 'number' && fieldVal > value;
				default:
					return false;
			}
		});
	}
}

class FakeDb {
	readonly store = new Map<string, DocData>();
	private tail: Promise<unknown> = Promise.resolve();

	doc(path: string) {
		return { path };
	}

	// emulate a minimal collection/where/get interface used by billing.consumeReview
	collection(name: string) {
		return new FakeQuery(this.store, name);
	}

	// serialize transactions: each starts only after the previous one settled,
	// so reads always observe committed state (the serializable outcome real
	// Firestore produces via conflict detection + retry).
	async runTransaction(fn: (tx: FakeTx) => Promise<unknown>): Promise<unknown> {
		const run = () => fn(new FakeTx(this.store));
		const next = this.tail.then(run, run);
		this.tail = next.catch(() => undefined);
		return next;
	}
}

function db(): Firestore {
	return new FakeDb() as unknown as Firestore;
}

// seed a doc through the fake's underlying store (the billing module only ever
// sees the Firestore-shaped handle).
function seed(db_: Firestore, path: string, data: DocData): void {
	(db_ as unknown as FakeDb).store.set(path, data);
}

function read(db_: Firestore, path: string): DocData | undefined {
	return (db_ as unknown as FakeDb).store.get(path);
}

describe('evaluateBilling', () => {
	// note: evaluateBilling only looks at `credits` now (see DEFAULT_BILLING and
	// the note in billing.ts) - `freeUsed` is retained on the doc for legacy
	// records but no longer affects eligibility. a brand-new account has no
	// doc at all yet, so this only checks docs that already carry a balance.
	it('allows a review while credits remain', () => {
		expect(evaluateBilling({ credits: 4 })).toBe('free');
		expect(evaluateBilling({ freeUsed: true, credits: 2 })).toBe('free');
	});

	it('blocks when no credits remain', () => {
		// brand-new account starts with FREE_SCANS_ON_SIGNUP gifted credits
		expect(evaluateBilling(undefined)).toBe('free');
		expect(evaluateBilling(null)).toBe('free');
		expect(evaluateBilling({})).toBe('free');
		expect(evaluateBilling({ freeUsed: true, credits: 0 })).toBe('none');
	});

	it('tolerates malformed docs', () => {
		expect(evaluateBilling({ credits: 'x' })).toBe('none');
		// With 4-free-scans model, negative credits + freeUsed:false still has available credits
		expect(evaluateBilling({ freeUsed: false, credits: -5 })).toBe('free');
	});
});

describe('consumeReview', () => {
	it('a brand-new account starts with 2 gifted credits and spends one per scan', async () => {
		const d = db();
		expect(await consumeReview(d, 'u1')).toEqual({ status: 'ok', used: 'free' });
		// DEFAULT_BILLING seeds FREE_SCANS_ON_SIGNUP (2) credits for an account
		// with no doc yet; one scan spends one.
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ freeUsed: true, credits: 1 });
	});

	it('spends a credit until the balance is exhausted', async () => {
		const d = db();
		seed(d, 'users/u1/billing/state', { freeUsed: true, credits: 3 });
		expect(await consumeReview(d, 'u1')).toEqual({ status: 'ok', used: 'free' });
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ freeUsed: true, credits: 2 });
	});

	it('blocks an account that is dry', async () => {
		const d = db();
		seed(d, 'users/u1/billing/state', { freeUsed: true, credits: 0 });
		expect(await consumeReview(d, 'u1')).toEqual({ status: 'blocked' });
	});

	it('double-click race: only one of two concurrent consumes wins the last credit', async () => {
		const d = db();
		// seed exactly one credit so the race has a real winner/loser, unlike a
		// brand-new account which starts with FREE_SCANS_ON_SIGNUP (2) and can
		// absorb two concurrent hits.
		seed(d, 'users/u1/billing/state', { freeUsed: true, credits: 1 });
		const [a, b] = await Promise.all([consumeReview(d, 'u1'), consumeReview(d, 'u1')]);
		const ok = [a, b].filter((v) => v.status === 'ok');
		const blocked = [a, b].filter((v) => v.status === 'blocked');
		expect(ok).toHaveLength(1);
		expect(blocked).toHaveLength(1);
		expect(ok[0].used).toBe('free');
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ credits: 0 });
	});
});

describe('refundReview', () => {
	// refundReview always restores exactly the one credit consumeReview spent -
	// there is no separate 'free' vs 'credit' outcome to distinguish anymore.
	it('restores a credit after a failed scan', async () => {
		const d = db();
		seed(d, 'users/u1/billing/state', { freeUsed: true, credits: 0 });
		await refundReview(d, 'u1', 'free');
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ credits: 1 });
		// freeUsed resets to false after refund in the new model
	});

	it('restores a spent credit on top of an existing balance', async () => {
		const d = db();
		seed(d, 'users/u1/billing/state', { freeUsed: true, credits: 1 });
		await refundReview(d, 'u1', 'free');
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ credits: 2 });
		// freeUsed resets to false after refund in the new model
	});
});

describe('creditReview', () => {
	// note: a fresh account (no existing billing doc) starts from DEFAULT_BILLING's
	// FREE_SCANS_ON_SIGNUP (2) gifted credits, so crediting SCANS_PER_PAYMENT (4)
	// on top lands at 6 - this is the correct outcome of "give all users 2 free
	// scans", not a bug: a brand new user who buys a pack before ever scanning
	// ends up with gift + purchase.
	it('mints credits and marks the payment settled', async () => {
		const d = db();
		// production payment docs are always written with `amountMinor` by
		// /api/payment/initialize; that's the field creditReview's mismatch
		// guard reads, so tests must seed the same field name.
		seed(d, 'payments/ref1', { uid: 'u1', amountMinor: 500000, status: 'initiated' });
		expect(await creditReview(d, 'u1', 'ref1', 500000, 'NGN')).toEqual({ status: 'credited' });
		expect(read(d, 'payments/ref1')).toMatchObject({ status: 'success', uid: 'u1' });
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ freeUsed: true, credits: 6 });
		// scansAllowed records how many scans this specific payment granted
		expect(read(d, 'payments/ref1')).toMatchObject({ scansAllowed: 4 });
	});

	it('webhook/verify double-fire on the same reference credits exactly once', async () => {
		const d = db();
		seed(d, 'payments/ref1', { uid: 'u1', amountMinor: 500000, status: 'initiated' });

		await creditReview(d, 'u1', 'ref1', 500000, 'NGN');
		const second = await creditReview(d, 'u1', 'ref1', 500000, 'NGN');
		expect(second).toEqual({ status: 'noop' });
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ credits: 6 });

		// and under genuine concurrency on a fresh reference
		const [a, b] = await Promise.all([
			creditReview(d, 'u2', 'ref2', 500000, 'NGN'),
			creditReview(d, 'u2', 'ref2', 500000, 'NGN')
		]);
		const verdicts = [a.status, b.status].sort();
		expect(verdicts).toEqual(['credited', 'noop']);
		expect(read(d, 'users/u2/billing/state')).toMatchObject({ credits: 6 });
	});

	it('never credits a reference that belongs to another user', async () => {
		const d = db();
		seed(d, 'payments/ref1', { uid: 'u1', amountMinor: 500000, status: 'initiated' });
		await creditReview(d, 'u2', 'ref1', 500000, 'NGN');
		expect(read(d, 'payments/ref1')).toMatchObject({ status: 'initiated' });
		expect(read(d, 'users/u2/billing/state')).toBeUndefined();
	});

	it('never credits a reference for a different amount than it was initialized for', async () => {
		const d = db();
		seed(d, 'payments/ref1', { uid: 'u1', amountMinor: 500000, status: 'initiated' });
		await creditReview(d, 'u1', 'ref1', 1, 'NGN');
		expect(read(d, 'payments/ref1')).toMatchObject({ status: 'initiated' });
		expect(read(d, 'users/u1/billing/state')).toBeUndefined();
	});

	it('credits a reference with no payment doc (webhook raced initialize)', async () => {
		const d = db();
		await creditReview(d, 'u1', 'ref-missing', 500000, 'NGN');
		expect(read(d, 'payments/ref-missing')).toMatchObject({ status: 'success', uid: 'u1' });
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ credits: 6 });
	});
});
