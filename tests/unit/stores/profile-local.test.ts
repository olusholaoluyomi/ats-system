import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// the localStorage fallback path for the profile store is exercised when
// firebase is not configured. mocks mirror applications-local.test.ts exactly.

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

const LOCAL_PROFILE_KEY = 'ats_local_profile_v1';

function clearStorage() {
	localStorage.removeItem(LOCAL_PROFILE_KEY);
}

function readStorage(): unknown {
	const raw = localStorage.getItem(LOCAL_PROFILE_KEY);
	return raw ? JSON.parse(raw) : null;
}

async function freshStore() {
	vi.resetModules();
	const mod = await import('../../../src/lib/stores/profile.svelte');
	return mod;
}

beforeEach(() => {
	clearStorage();
});

afterEach(() => {
	clearStorage();
});

describe('self-host profile: localStorage backed', () => {
	it('starts at the default profile when localStorage is empty', async () => {
		const { profileStore, DEFAULT_PROFILE } = await freshStore();
		await profileStore.load();
		expect(profileStore.profile).toEqual(DEFAULT_PROFILE);
		expect(profileStore.loaded).toBe(true);
	});

	it('reads pre-existing localStorage preferences on load', async () => {
		const seeded = {
			displayName: 'Ada',
			photoURL: '',
			preferredRemoteOnly: true,
			preferredKeywords: 'backend engineer',
			notifyOnMatch: false,
			notifyKeywords: '',
			notifyRemoteOnly: false
		};
		localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(seeded));
		const { profileStore } = await freshStore();
		await profileStore.load();
		expect(profileStore.profile).toEqual(seeded);
	});

	it('save merges changes into the existing profile and persists them', async () => {
		const { profileStore } = await freshStore();
		await profileStore.load();
		const ok = await profileStore.save({ preferredKeywords: 'product manager' });

		expect(ok).toBe(true);
		expect(profileStore.profile.preferredKeywords).toBe('product manager');
		expect(profileStore.profile.preferredRemoteOnly).toBe(false); // untouched default
		expect(readStorage()).toMatchObject({ preferredKeywords: 'product manager' });
	});

	it('save is a partial update - one field does not clobber another already saved', async () => {
		const { profileStore } = await freshStore();
		await profileStore.load();
		await profileStore.save({ notifyOnMatch: true, notifyKeywords: 'network engineer' });
		await profileStore.save({ preferredRemoteOnly: true });

		expect(profileStore.profile.notifyOnMatch).toBe(true);
		expect(profileStore.profile.notifyKeywords).toBe('network engineer');
		expect(profileStore.profile.preferredRemoteOnly).toBe(true);
	});

	it('resetForSignOut clears in-memory state back to defaults without touching localStorage', async () => {
		const { profileStore, DEFAULT_PROFILE } = await freshStore();
		await profileStore.load();
		await profileStore.save({ preferredKeywords: 'designer' });

		profileStore.resetForSignOut();

		expect(profileStore.profile).toEqual(DEFAULT_PROFILE);
		expect(profileStore.loaded).toBe(false);
		expect(readStorage()).toMatchObject({ preferredKeywords: 'designer' });
	});

	it('does not call firestore on the self-host path (no network attempts)', async () => {
		const { profileStore } = await freshStore();
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
		await profileStore.load();
		await profileStore.save({ preferredKeywords: 'x' });
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
