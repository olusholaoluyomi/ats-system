import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// the landing-page counters (Users Served, Resumes Analyzed) are incremented
// in a single insights/global doc, deliberately separate from user scan
// records so they keep growing even when a user clears their history. these
// tests pin the write shape (setDoc on insights/global with increment(1) and
// merge:true) and the self-host no-op guard.

let firestoreLib: { firebaseConfigured: boolean; getFirebase: ReturnType<typeof vi.fn> };

function mockFirebaseModule(config: {
	configured: boolean;
	getFirebase?: () => Promise<unknown>;
}): void {
	firestoreLib = {
		firebaseConfigured: config.configured,
		getFirebase: vi.fn(
			config.getFirebase ?? (() => Promise.reject(new Error('firebase init failed')))
		)
	};
	vi.doMock('$lib/firebase', () => firestoreLib);
	vi.doMock('firebase/firestore', () => ({
		doc: vi.fn(() => 'doc-ref'),
		setDoc: vi.fn().mockResolvedValue(undefined),
		increment: vi.fn((n: number) => n)
	}));
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe('insights counters', () => {
	it('increments userCount on the insights/global doc with merge:true', async () => {
		mockFirebaseModule({
			configured: true,
			getFirebase: () => Promise.resolve({ auth: {}, db: {} })
		});
		const { incrementUserCount } = await import('../../src/lib/insights');
		const { doc, setDoc } = await import('firebase/firestore');

		await incrementUserCount();

		expect(doc).toHaveBeenCalledWith({}, 'insights', 'global');
		expect(setDoc).toHaveBeenCalledTimes(1);
		const [, data, options] = (setDoc as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(options).toEqual({ merge: true });
		expect(data).toEqual({ userCount: 1 });
	});

	it('increments resumesAnalyzed on the insights/global doc with merge:true', async () => {
		mockFirebaseModule({
			configured: true,
			getFirebase: () => Promise.resolve({ auth: {}, db: {} })
		});
		const { incrementResumesAnalyzed } = await import('../../src/lib/insights');
		const { doc, setDoc } = await import('firebase/firestore');

		await incrementResumesAnalyzed();

		expect(doc).toHaveBeenCalledWith({}, 'insights', 'global');
		expect(setDoc).toHaveBeenCalledTimes(1);
		const [, data, options] = (setDoc as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(options).toEqual({ merge: true });
		expect(data).toEqual({ resumesAnalyzed: 1 });
	});

	it('is a no-op when firebase is not configured', async () => {
		mockFirebaseModule({ configured: false });
		const { incrementResumesAnalyzed } = await import('../../src/lib/insights');
		const { setDoc } = await import('firebase/firestore');

		await incrementResumesAnalyzed();

		expect(setDoc).not.toHaveBeenCalled();
		expect(firestoreLib.getFirebase).not.toHaveBeenCalled();
	});

	it('swallows firebase init failures instead of throwing', async () => {
		mockFirebaseModule({ configured: true });
		const { incrementResumesAnalyzed } = await import('../../src/lib/insights');

		await expect(incrementResumesAnalyzed()).resolves.toBeUndefined();
		expect(firestoreLib.getFirebase).toHaveBeenCalled();
	});
});
