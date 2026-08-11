import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { consumeReview, creditReview, evaluateBilling, refundReview } from '../../../src/lib/server/billing';

// the billing module is pure over a Firestore-like handle (doc/runTransaction),
// so these tests drive it against an in-memory Map. Firestore's optimistic
// concurrency guarantees that concurrent transactions end in a serial order
// (retrying any that conflict); the fake models that serial outcome directly by
// running transactions one-at-a-time in call order, each reading the latest
// committed state. that is exactly the invariant the double-click-free-review
// race and the webhook/verify double-fire race rely on.

type DocData = Record<string, unknown>;

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

class FakeDb {
	readonly store = new Map<string, DocData>();
	private tail: Promise<unknown> = Promise.resolve();

	doc(path: string) {
		return { path };
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
	it('grants the free review to a brand-new account', () => {
		expect(evaluateBilling(undefined)).toBe('free');
		expect(evaluateBilling(null)).toBe('free');
		expect(evaluateBilling({})).toBe('free');
	});

	it('falls back to credits once the free review is used', () => {
		expect(evaluateBilling({ freeUsed: true, credits: 2 })).toBe('credit');
	});

	it('blocks when the free review is used and no credits remain', () => {
		expect(evaluateBilling({ freeUsed: true, credits: 0 })).toBe('none');
	});

	it('tolerates malformed docs', () => {
		expect(evaluateBilling({ credits: 'x' })).toBe('free');
		expect(evaluateBilling({ freeUsed: true })).toBe('none');
		expect(evaluateBilling({ freeUsed: false, credits: -5 })).toBe('free');
	});
});

describe('consumeReview', () => {
	it('grants the free review first and marks it used', async () => {
		const d = db();
		expect(await consumeReview(d, 'u1')).toEqual({ status: 'ok', used: 'free' });
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ freeUsed: true, credits: 0 });
	});

	it('spends a credit once the free review is gone', async () => {
		const d = db();
		seed(d, 'users/u1/billing/state', { freeUsed: true, credits: 3 });
		expect(await consumeReview(d, 'u1')).toEqual({ status: 'ok', used: 'credit' });
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ freeUsed: true, credits: 2 });
	});

	it('blocks an account that is dry', async () => {
		const d = db();
		seed(d, 'users/u1/billing/state', { freeUsed: true, credits: 0 });
		expect(await consumeReview(d, 'u1')).toEqual({ status: 'blocked' });
	});

	it('double-click race: only one of two concurrent consumes wins the free review', async () => {
		const d = db();
		const [a, b] = await Promise.all([consumeReview(d, 'u1'), consumeReview(d, 'u1')]);
		const ok = [a, b].filter((v) => v.status === 'ok');
		const blocked = [a, b].filter((v) => v.status === 'blocked');
		expect(ok).toHaveLength(1);
		expect(blocked).toHaveLength(1);
		// the winner was charged 'free', not a credit
		expect(ok[0].used).toBe('free');
	});
});

describe('refundReview', () => {
	it('resets the free review', async () => {
		const d = db();
		seed(d, 'users/u1/billing/state', { freeUsed: true, credits: 0 });
		await refundReview(d, 'u1', 'free');
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ freeUsed: false, credits: 0 });
	});

	it('restores a spent credit', async () => {
		const d = db();
		seed(d, 'users/u1/billing/state', { freeUsed: true, credits: 1 });
		await refundReview(d, 'u1', 'credit');
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ freeUsed: true, credits: 2 });
	});
});

describe('creditReview', () => {
	it('mints a credit and marks the payment settled', async () => {
		const d = db();
		seed(d, 'payments/ref1', { uid: 'u1', amountKobo: 500000, status: 'initiated' });
		expect(await creditReview(d, 'u1', 'ref1', 500000, 'NGN')).toEqual({ status: 'credited' });
		expect(read(d, 'payments/ref1')).toMatchObject({ status: 'success', uid: 'u1' });
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ freeUsed: false, credits: 1 });
	});

	it('webhook/verify double-fire on the same reference credits exactly once', async () => {
		const d = db();
		seed(d, 'payments/ref1', { uid: 'u1', amountKobo: 500000, status: 'initiated' });

		await creditReview(d, 'u1', 'ref1', 500000, 'NGN');
		const second = await creditReview(d, 'u1', 'ref1', 500000, 'NGN');
		expect(second).toEqual({ status: 'noop' });
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ credits: 1 });

		// and under genuine concurrency on a fresh reference
		const [a, b] = await Promise.all([
			creditReview(d, 'u2', 'ref2', 500000, 'NGN'),
			creditReview(d, 'u2', 'ref2', 500000, 'NGN')
		]);
		const verdicts = [a.status, b.status].sort();
		expect(verdicts).toEqual(['credited', 'noop']);
		expect(read(d, 'users/u2/billing/state')).toMatchObject({ credits: 1 });
	});

	it('never credits a reference that belongs to another user', async () => {
		const d = db();
		seed(d, 'payments/ref1', { uid: 'u1', amountKobo: 500000, status: 'initiated' });
		await creditReview(d, 'u2', 'ref1', 500000, 'NGN');
		expect(read(d, 'payments/ref1')).toMatchObject({ status: 'initiated' });
		expect(read(d, 'users/u2/billing/state')).toBeUndefined();
	});

	it('never credits a reference for a different amount than it was initialized for', async () => {
		const d = db();
		seed(d, 'payments/ref1', { uid: 'u1', amountKobo: 500000, status: 'initiated' });
		await creditReview(d, 'u1', 'ref1', 1, 'NGN');
		expect(read(d, 'payments/ref1')).toMatchObject({ status: 'initiated' });
		expect(read(d, 'users/u1/billing/state')).toBeUndefined();
	});

	it('credits a reference with no payment doc (webhook raced initialize)', async () => {
		const d = db();
		await creditReview(d, 'u1', 'ref-missing', 500000, 'NGN');
		expect(read(d, 'payments/ref-missing')).toMatchObject({ status: 'success', uid: 'u1' });
		expect(read(d, 'users/u1/billing/state')).toMatchObject({ credits: 1 });
	});
});

