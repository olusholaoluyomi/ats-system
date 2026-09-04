import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { JobListing } from '../../../src/routes/jobs/shared';

// the localStorage fallback path for the tracker is exercised when firebase
// is not configured. mocks mirror scores-local-history.test.ts exactly.

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('../../../src/lib/log', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));

const LOCAL_APPLICATIONS_KEY = 'ats_local_applications_v1';

function clearStorage() {
	localStorage.removeItem(LOCAL_APPLICATIONS_KEY);
}

function readStorage(): unknown[] {
	const raw = localStorage.getItem(LOCAL_APPLICATIONS_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function stubJob(overrides: Partial<JobListing> = {}): JobListing {
	return {
		id: 'greenhouse:123',
		companyName: 'Acme',
		title: 'Backend Engineer',
		department: null,
		locationRaw: 'Remote',
		remote: true,
		applyUrl: 'https://acme.example.com/apply',
		whyThisCompany: null,
		firstSeenAt: new Date().toISOString(),
		...overrides
	};
}

async function freshStore() {
	vi.resetModules();
	const mod = await import('../../../src/lib/stores/applications.svelte');
	return mod;
}

beforeEach(() => {
	clearStorage();
});

afterEach(() => {
	clearStorage();
});

describe('self-host application tracker: localStorage backed', () => {
	it('starts empty when localStorage is empty', async () => {
		const { applicationsStore } = await freshStore();
		await applicationsStore.load();
		expect(applicationsStore.list).toEqual([]);
	});

	it('reads pre-existing localStorage entries on load', async () => {
		const seeded = [
			{
				id: 'local-seed-1',
				source: 'manual',
				jobId: null,
				companyName: 'Seeded Co',
				title: 'Seeded Role',
				applyUrl: null,
				status: 'applied',
				notes: '',
				appliedAt: '2026-05-01T00:00:00.000Z',
				createdAt: '2026-05-01T00:00:00.000Z',
				updatedAt: '2026-05-01T00:00:00.000Z'
			}
		];
		localStorage.setItem(LOCAL_APPLICATIONS_KEY, JSON.stringify(seeded));
		const { applicationsStore } = await freshStore();
		await applicationsStore.load();
		expect(applicationsStore.list).toEqual(seeded);
	});

	it('addFromBoard writes a new entry keyed by the job id, status saved', async () => {
		const { applicationsStore } = await freshStore();
		const job = stubJob();
		const entry = await applicationsStore.addFromBoard(job);

		expect(entry?.id).toBe(job.id);
		expect(entry?.source).toBe('board');
		expect(entry?.status).toBe('saved');
		expect(entry?.appliedAt).toBeNull();
		expect(readStorage()).toHaveLength(1);
		expect(applicationsStore.list).toHaveLength(1);
	});

	it('addFromBoard is idempotent: a second call for the same job does not duplicate or reset an already-changed status', async () => {
		const { applicationsStore } = await freshStore();
		const job = stubJob();
		await applicationsStore.addFromBoard(job);
		await applicationsStore.updateStatus(job.id, 'interviewing');

		const second = await applicationsStore.addFromBoard(job);

		expect(applicationsStore.list).toHaveLength(1);
		expect(second?.status).toBe('interviewing'); // not reset back to 'saved'
		expect(readStorage()).toHaveLength(1);
	});

	it('addManual defaults jobId to null and generates a local- prefixed id', async () => {
		const { applicationsStore } = await freshStore();
		const entry = await applicationsStore.addManual({
			companyName: 'Found Elsewhere Inc',
			title: 'Frontend Engineer',
			status: 'applied'
		});

		expect(entry?.jobId).toBeNull();
		expect(entry?.source).toBe('manual');
		expect(entry?.id).toMatch(/^local-/);
		expect(entry?.applyUrl).toBeNull();
		expect(entry?.notes).toBe('');
	});

	it('addManual with status applied sets appliedAt; status saved does not', async () => {
		const { applicationsStore } = await freshStore();
		const applied = await applicationsStore.addManual({
			companyName: 'A',
			title: 'A role',
			status: 'applied'
		});
		const saved = await applicationsStore.addManual({
			companyName: 'B',
			title: 'B role',
			status: 'saved'
		});

		expect(applied?.appliedAt).not.toBeNull();
		expect(saved?.appliedAt).toBeNull();
	});

	it('updateStatus sets appliedAt the first time status moves past saved, and leaves it unchanged afterward', async () => {
		const { applicationsStore } = await freshStore();
		const job = stubJob();
		await applicationsStore.addFromBoard(job);

		await applicationsStore.updateStatus(job.id, 'applied');
		const afterFirst = applicationsStore.list.find((a) => a.id === job.id);
		expect(afterFirst?.appliedAt).not.toBeNull();
		const firstAppliedAt = afterFirst?.appliedAt;

		await applicationsStore.updateStatus(job.id, 'interviewing');
		const afterSecond = applicationsStore.list.find((a) => a.id === job.id);
		expect(afterSecond?.appliedAt).toBe(firstAppliedAt); // untouched
		expect(afterSecond?.status).toBe('interviewing');
	});

	it('updateStatus back to saved does not clear an already-set appliedAt', async () => {
		const { applicationsStore } = await freshStore();
		const job = stubJob();
		await applicationsStore.addFromBoard(job);
		await applicationsStore.updateStatus(job.id, 'applied');
		const applied = applicationsStore.list.find((a) => a.id === job.id);

		await applicationsStore.updateStatus(job.id, 'saved');
		const backToSaved = applicationsStore.list.find((a) => a.id === job.id);
		expect(backToSaved?.status).toBe('saved');
		expect(backToSaved?.appliedAt).toBe(applied?.appliedAt);
	});

	it('updateNotes updates only notes and updatedAt', async () => {
		const { applicationsStore } = await freshStore();
		const job = stubJob();
		const original = await applicationsStore.addFromBoard(job);

		await applicationsStore.updateNotes(job.id, 'Recruiter called back');
		const updated = applicationsStore.list.find((a) => a.id === job.id);

		expect(updated?.notes).toBe('Recruiter called back');
		expect(updated?.status).toBe(original?.status);
		expect(updated?.companyName).toBe(original?.companyName);
	});

	it('remove deletes the entry from memory and localStorage', async () => {
		const { applicationsStore } = await freshStore();
		const job = stubJob();
		await applicationsStore.addFromBoard(job);
		expect(readStorage()).toHaveLength(1);

		await applicationsStore.remove(job.id);
		expect(applicationsStore.list).toEqual([]);
		expect(readStorage()).toEqual([]);
	});

	it('does not call firestore on the self-host path (no network attempts)', async () => {
		const { applicationsStore } = await freshStore();
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
		await applicationsStore.addFromBoard(stubJob());
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});

describe('shouldSetAppliedAt', () => {
	it('is true when there is no appliedAt yet and the next status is not saved', async () => {
		const { shouldSetAppliedAt } = await freshStore();
		expect(shouldSetAppliedAt(null, 'applied')).toBe(true);
		expect(shouldSetAppliedAt(null, 'interviewing')).toBe(true);
	});

	it('is false when the next status is saved, even with no prior appliedAt', async () => {
		const { shouldSetAppliedAt } = await freshStore();
		expect(shouldSetAppliedAt(null, 'saved')).toBe(false);
	});

	it('is false once appliedAt is already set, regardless of the next status', async () => {
		const { shouldSetAppliedAt } = await freshStore();
		expect(shouldSetAppliedAt('2026-05-01T00:00:00.000Z', 'interviewing')).toBe(false);
		expect(shouldSetAppliedAt('2026-05-01T00:00:00.000Z', 'saved')).toBe(false);
	});
});
