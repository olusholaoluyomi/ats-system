import { browser } from '$app/environment';
import { firebaseConfigured, getFirebase } from '$lib/firebase';
import { logger } from '$lib/log';
import { authStore } from './auth.svelte';

// self-host bucket, mirroring applications.svelte.ts's LOCAL_APPLICATIONS_KEY:
// when firebase is not configured, the profile persists to localStorage under
// this key so self-host installs still get session-spanning preferences on
// the same device.
const LOCAL_PROFILE_KEY = 'ats_local_profile_v1';

function localProfileKey(): string {
	if (authStore.mode === 'ldap' && authStore.ldapSub) {
		return `${LOCAL_PROFILE_KEY}__${authStore.ldapSub}`;
	}
	return LOCAL_PROFILE_KEY;
}

export interface UserProfile {
	displayName: string;
	photoURL: string;
	preferredRemoteOnly: boolean;
	preferredKeywords: string;
	notifyOnMatch: boolean;
	notifyKeywords: string;
	notifyRemoteOnly: boolean;
}

export const DEFAULT_PROFILE: UserProfile = {
	displayName: '',
	photoURL: '',
	preferredRemoteOnly: false,
	preferredKeywords: '',
	notifyOnMatch: false,
	notifyKeywords: '',
	notifyRemoteOnly: false
};

function readLocalProfile(): UserProfile {
	if (!browser) return { ...DEFAULT_PROFILE };
	try {
		const raw = localStorage.getItem(localProfileKey());
		if (!raw) return { ...DEFAULT_PROFILE };
		const parsed = JSON.parse(raw);
		return { ...DEFAULT_PROFILE, ...parsed };
	} catch (err) {
		logger.warn('profile.local_read_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		return { ...DEFAULT_PROFILE };
	}
}

function writeLocalProfile(profile: UserProfile): void {
	if (!browser) return;
	try {
		localStorage.setItem(localProfileKey(), JSON.stringify(profile));
	} catch (err) {
		logger.warn('profile.local_write_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

class ProfileStore {
	profile = $state<UserProfile>({ ...DEFAULT_PROFILE });
	loading = $state(false);
	loaded = $state(false);

	async load() {
		if (!browser) return;

		if (!firebaseConfigured) {
			this.loading = true;
			this.profile = readLocalProfile();
			this.loading = false;
			this.loaded = true;
			return;
		}

		if (!authStore.isAuthenticated || !authStore.user) return;

		this.loading = true;
		try {
			const uid = authStore.user.uid;
			const { db } = await getFirebase();
			const { doc, getDoc } = await import('firebase/firestore');
			const snap = await getDoc(doc(db, 'users', uid, 'profile', 'settings'));
			this.profile = snap.exists()
				? { ...DEFAULT_PROFILE, ...(snap.data() as Partial<UserProfile>) }
				: { ...DEFAULT_PROFILE };
		} catch (err) {
			logger.warn('profile.load_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
			this.profile = { ...DEFAULT_PROFILE };
		} finally {
			this.loading = false;
			this.loaded = true;
		}
	}

	async save(changes: Partial<UserProfile>): Promise<boolean> {
		const next: UserProfile = { ...this.profile, ...changes };

		if (!firebaseConfigured) {
			writeLocalProfile(next);
			this.profile = next;
			return true;
		}

		if (!authStore.isAuthenticated || !authStore.user) return false;

		try {
			const uid = authStore.user.uid;
			const { db } = await getFirebase();
			const { doc, setDoc } = await import('firebase/firestore');
			const sanitized = JSON.parse(JSON.stringify(next));
			await setDoc(doc(db, 'users', uid, 'profile', 'settings'), sanitized);
			this.profile = next;
			return true;
		} catch (err) {
			logger.error('profile.save_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
			return false;
		}
	}

	// module-level singleton outlives any one component, same reasoning as
	// applicationsStore.resetForSignOut() - without this, a second person
	// signing in on a shared browser tab would briefly see the previous
	// account's preferences.
	resetForSignOut() {
		this.profile = { ...DEFAULT_PROFILE };
		this.loaded = false;
	}
}

export const profileStore = new ProfileStore();
