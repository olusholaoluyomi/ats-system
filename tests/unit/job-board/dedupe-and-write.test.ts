import { describe, expect, it } from 'vitest';
import {
	upsertCompanyPostings,
	sweepInactiveJobs,
	jobId
} from '../../../src/lib/server/job-board/dedupe-and-write';
import type { SeedCompany } from '../../../src/lib/server/job-board/seed-companies';
import type { RawJobPosting } from '../../../src/lib/server/job-board/types';

// minimal in-memory fake standing in for firebase-admin's Firestore: just
// enough surface (doc/collection/where/get/runTransaction) for
// dedupe-and-write.ts's actual usage, keyed by doc path.
function createFakeDb() {
	const store = new Map<string, Record<string, unknown>>();

	function makeRef(path: string) {
		return {
			path,
			get: async () => ({
				exists: store.has(path),
				id: path.split('/').pop(),
				data: () => store.get(path)
			}),
			set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
				const existing = opts?.merge ? (store.get(path) ?? {}) : {};
				store.set(path, { ...existing, ...data });
			}
		};
	}

	return {
		store,
		doc: (path: string) => makeRef(path),
		collection: (name: string) => ({
			where: (field: string, _op: string, value: unknown) => ({
				get: async () => {
					const docs = [...store.entries()]
						.filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
						.map(([path, data]) => ({
							id: path.split('/').pop(),
							ref: makeRef(path),
							data: () => data
						}));
					return { docs };
				}
			})
		}),
		runTransaction: async (
			fn: (tx: {
				get: (ref: ReturnType<typeof makeRef>) => Promise<unknown>;
				set: (ref: ReturnType<typeof makeRef>, data: Record<string, unknown>) => void;
			}) => Promise<unknown>
		) => {
			const tx = {
				get: (ref: ReturnType<typeof makeRef>) => ref.get(),
				set: (ref: ReturnType<typeof makeRef>, data: Record<string, unknown>) => {
					store.set(ref.path, data);
				}
			};
			return fn(tx);
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

		expect(results).toEqual([{ jobId: 'greenhouse:1', isNew: true }]);
		const doc = db.store.get('jobs/greenhouse:1');
		expect(doc?.firstSeenAt).toBeInstanceOf(Date);
		expect(doc?.active).toBe(true);
		expect(doc?.companyName).toBe('Acme');
	});

	it('marks a re-ingested posting as not new and preserves firstSeenAt', async () => {
		const db = createFakeDb();
		await upsertCompanyPostings(db as never, COMPANY, [posting()]);
		const firstSeenAt = db.store.get('jobs/greenhouse:1')?.firstSeenAt;

		const results = await upsertCompanyPostings(
			db as never,
			COMPANY,
			[posting({ title: 'Senior Engineer' })] // description/title changed on re-fetch
		);

		expect(results).toEqual([{ jobId: 'greenhouse:1', isNew: false }]);
		const doc = db.store.get('jobs/greenhouse:1');
		expect(doc?.title).toBe('Senior Engineer'); // refreshed
		expect(doc?.firstSeenAt).toBe(firstSeenAt); // preserved, not reset
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
});

describe('sweepInactiveJobs', () => {
	it('marks an untouched, stale active job inactive', async () => {
		const db = createFakeDb();
		db.store.set('jobs/greenhouse:99', {
			active: true,
			lastSeenAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24h ago
		});

		const swept = await sweepInactiveJobs(db as never, new Set(), 12 * 60 * 60 * 1000);

		expect(swept).toBe(1);
		expect(db.store.get('jobs/greenhouse:99')?.active).toBe(false);
	});

	it('does not sweep a job that was touched this run', async () => {
		const db = createFakeDb();
		db.store.set('jobs/greenhouse:1', {
			active: true,
			lastSeenAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
		});

		const swept = await sweepInactiveJobs(
			db as never,
			new Set(['greenhouse:1']),
			12 * 60 * 60 * 1000
		);

		expect(swept).toBe(0);
		expect(db.store.get('jobs/greenhouse:1')?.active).toBe(true);
	});

	it('does not sweep a job that is not stale yet', async () => {
		const db = createFakeDb();
		db.store.set('jobs/greenhouse:1', {
			active: true,
			lastSeenAt: new Date() // just seen
		});

		const swept = await sweepInactiveJobs(db as never, new Set(), 12 * 60 * 60 * 1000);

		expect(swept).toBe(0);
		expect(db.store.get('jobs/greenhouse:1')?.active).toBe(true);
	});
});
