import { describe, expect, it } from 'vitest';
import {
	upsertCompanyPostings,
	deleteStalePostings,
	jobId
} from '../../../src/lib/server/job-board/dedupe-and-write';
import type { SeedCompany } from '../../../src/lib/server/job-board/seed-companies';
import type { RawJobPosting } from '../../../src/lib/server/job-board/types';

// minimal in-memory fake standing in for firebase-admin's Firestore: just
// enough surface (doc/collection/where/limit/get/batch) for
// dedupe-and-write.ts's actual usage, keyed by doc path.
function createFakeDb() {
	const store = new Map<string, Record<string, unknown>>();

	function makeRef(path: string) {
		return {
			path,
			id: path.split('/').pop(),
			get: async () => ({
				exists: store.has(path),
				id: path.split('/').pop(),
				data: () => store.get(path)
			})
		};
	}

	function makeQuery(name: string, predicates: ((data: Record<string, unknown>) => boolean)[]) {
		return {
			where: (field: string, op: string, value: unknown) => {
				const predicate = (data: Record<string, unknown>) => {
					if (op === '==') return data[field] === value;
					if (op === '<') {
						const a = data[field];
						return a instanceof Date && value instanceof Date && a.getTime() < value.getTime();
					}
					throw new Error(`unsupported op in fake db: ${op}`);
				};
				return makeQuery(name, [...predicates, predicate]);
			},
			limit: (n: number) => ({
				get: async () => {
					const docs = [...store.entries()]
						.filter(
							([path, data]) => path.startsWith(`${name}/`) && predicates.every((p) => p(data))
						)
						.slice(0, n)
						.map(([path, data]) => ({
							id: path.split('/').pop(),
							ref: makeRef(path),
							data: () => data
						}));
					return { docs, empty: docs.length === 0, size: docs.length };
				}
			}),
			get: async () => {
				const docs = [...store.entries()]
					.filter(([path, data]) => path.startsWith(`${name}/`) && predicates.every((p) => p(data)))
					.map(([path, data]) => ({
						id: path.split('/').pop(),
						ref: makeRef(path),
						data: () => data
					}));
				return { docs, empty: docs.length === 0, size: docs.length };
			}
		};
	}

	return {
		store,
		doc: (path: string) => makeRef(path),
		collection: (name: string) => makeQuery(name, []),
		batch: () => {
			const ops: {
				type: 'set' | 'delete';
				ref: ReturnType<typeof makeRef>;
				data?: Record<string, unknown>;
			}[] = [];
			return {
				set: (ref: ReturnType<typeof makeRef>, data: Record<string, unknown>) => {
					ops.push({ type: 'set', ref, data });
				},
				delete: (ref: ReturnType<typeof makeRef>) => {
					ops.push({ type: 'delete', ref });
				},
				commit: async () => {
					for (const op of ops) {
						if (op.type === 'delete') {
							store.delete(op.ref.path);
						} else {
							const existing = store.get(op.ref.path) ?? {};
							store.set(op.ref.path, { ...existing, ...op.data });
						}
					}
				}
			};
		}
	};
}

const COMPANY: SeedCompany = {
	slug: 'acme',
	name: 'Acme',
	atsType: 'greenhouse',
	boardToken: 'acme',
	whyThisCompany: 'Test company',
	enabled: true
};

function posting(overrides: Partial<RawJobPosting> = {}): RawJobPosting {
	return {
		externalId: '1',
		title: 'Engineer',
		locationRaw: 'Remote',
		remote: true,
		applyUrl: 'https://example.com/1',
		descriptionText: 'Build things.',
		postedAtSource: null,
		...overrides
	};
}

describe('jobId', () => {
	it('is deterministic per source + external id', () => {
		expect(jobId('greenhouse', '123')).toBe('greenhouse:123');
	});
});

describe('upsertCompanyPostings', () => {
	it('inserts a new posting and stamps firstSeenAt', async () => {
		const db = createFakeDb();
		const results = await upsertCompanyPostings(db as never, COMPANY, [posting()]);

		expect(results).toEqual([{ jobId: 'greenhouse:1', isNew: true, written: true }]);
		const doc = db.store.get('jobs/greenhouse:1');
		expect(doc?.firstSeenAt).toBeInstanceOf(Date);
		expect(doc?.active).toBe(true);
		expect(doc?.companyName).toBe('Acme');
		expect(doc?.searchKeywords).toEqual(expect.arrayContaining(['engineer', 'acme']));
	});

	it('marks a re-ingested posting with changed content as written, preserves firstSeenAt', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [posting()]);
		const firstSeenAt = db.store.get('jobs/greenhouse:1')?.firstSeenAt;

		const results = await upsertCompanyPostings(
			db as never,
			COMPANY,
			[posting({ title: 'Senior Engineer' })] // title changed on re-fetch
		);

		expect(results).toEqual([{ jobId: 'greenhouse:1', isNew: false, written: true }]);
		const doc = db.store.get('jobs/greenhouse:1');
		expect(doc?.title).toBe('Senior Engineer'); // refreshed
		expect(doc?.firstSeenAt).toBe(firstSeenAt); // preserved, not reset
	});

	it('skips the write entirely for a re-ingested posting with identical content (quota-critical)', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [posting()]);
		const before = db.store.get('jobs/greenhouse:1');

		const results = await upsertCompanyPostings(db as never, COMPANY, [posting()]);

		expect(results).toEqual([{ jobId: 'greenhouse:1', isNew: false, written: false }]);
		expect(db.store.get('jobs/greenhouse:1')).toEqual(before); // byte-for-byte untouched, including updatedAt
	});

	it('reactivates a previously-deactivated posting that reappears', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [posting()]);
		db.store.set('jobs/greenhouse:1', {
			...db.store.get('jobs/greenhouse:1'),
			active: false
		});

		const results = await upsertCompanyPostings(db as never, COMPANY, [posting()]);

		expect(results).toEqual([{ jobId: 'greenhouse:1', isNew: false, written: true }]);
		expect(db.store.get('jobs/greenhouse:1')?.active).toBe(true);
	});

	it('deactivates a previously-active posting that this run did not fetch, using only the one company-scoped read', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [
			posting({ externalId: '1' }),
			posting({ externalId: '2' })
		]);

		const results = await upsertCompanyPostings(db as never, COMPANY, [
			posting({ externalId: '1' })
		]);

		// posting 2 wasn't in this run's fetch and isn't in the returned
		// results at all (results only cover THIS run's fetched postings) -
		// but its doc should now be inactive.
		expect(results).toEqual([{ jobId: 'greenhouse:1', isNew: false, written: false }]);
		expect(db.store.get('jobs/greenhouse:2')?.active).toBe(false);
	});

	it('does not re-deactivate (write) a posting that is already inactive', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [
			posting({ externalId: '1' }),
			posting({ externalId: '2' })
		]);
		await upsertCompanyPostings(db as never, COMPANY, [posting({ externalId: '1' })]);
		const afterFirstSweep = db.store.get('jobs/greenhouse:2');

		await upsertCompanyPostings(db as never, COMPANY, [posting({ externalId: '1' })]);

		expect(db.store.get('jobs/greenhouse:2')).toEqual(afterFirstSweep); // untouched, no re-write
	});

	it('extracts years-of-experience from descriptionText via the non-AI heuristic', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [
			posting({ descriptionText: 'Looking for someone with 5-7 years of experience.' })
		]);

		const doc = db.store.get('jobs/greenhouse:1');
		expect(doc?.minYearsExperience).toBe(5);
		expect(doc?.maxYearsExperience).toBe(7);
	});

	it('stores null years-of-experience when the description has no detectable phrase', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [
			posting({ descriptionText: 'Build things.' })
		]);

		const doc = db.store.get('jobs/greenhouse:1');
		expect(doc?.minYearsExperience).toBeNull();
		expect(doc?.maxYearsExperience).toBeNull();
	});

	it('derives workMode from remote/locationRaw/workplaceTypeRaw', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [
			posting({ externalId: '1', remote: true }),
			posting({ externalId: '2', remote: false, locationRaw: 'Hybrid - NYC' }),
			posting({ externalId: '3', remote: false, locationRaw: 'NYC' })
		]);

		expect(db.store.get('jobs/greenhouse:1')?.workMode).toBe('remote');
		expect(db.store.get('jobs/greenhouse:2')?.workMode).toBe('hybrid');
		expect(db.store.get('jobs/greenhouse:3')?.workMode).toBe('onsite');
	});

	it('extracts compensation and relocation support from descriptionText', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [
			posting({
				descriptionText: 'Pay: $120,000 - $150,000 per year. We offer relocation assistance.'
			})
		]);

		const doc = db.store.get('jobs/greenhouse:1');
		expect(doc?.compensationText).toBe('$120,000 - $150,000 per year');
		expect(doc?.relocationSupport).toBe(true);
	});

	it('stores null compensation and false relocation support when absent', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [
			posting({ descriptionText: 'Build things.' })
		]);

		const doc = db.store.get('jobs/greenhouse:1');
		expect(doc?.compensationText).toBeNull();
		expect(doc?.relocationSupport).toBe(false);
	});
});

describe('deleteStalePostings', () => {
	it('deletes an inactive posting past the age cutoff', async () => {
		const db = createFakeDb();
		db.store.set('jobs/greenhouse:99', {
			active: false,
			updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) // 20 days ago
		});

		const deleted = await deleteStalePostings(db as never, 14 * 24 * 60 * 60 * 1000);

		expect(deleted).toBe(1);
		expect(db.store.has('jobs/greenhouse:99')).toBe(false);
	});

	it('leaves an active posting alone regardless of age', async () => {
		const db = createFakeDb();
		db.store.set('jobs/greenhouse:1', {
			active: true,
			updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
		});

		const deleted = await deleteStalePostings(db as never, 14 * 24 * 60 * 60 * 1000);

		expect(deleted).toBe(0);
		expect(db.store.has('jobs/greenhouse:1')).toBe(true);
	});

	it('leaves a recently-deactivated posting alone', async () => {
		const db = createFakeDb();
		db.store.set('jobs/greenhouse:1', {
			active: false,
			updatedAt: new Date() // just deactivated
		});

		const deleted = await deleteStalePostings(db as never, 14 * 24 * 60 * 60 * 1000);

		expect(deleted).toBe(0);
		expect(db.store.has('jobs/greenhouse:1')).toBe(true);
	});
});
