import { browser } from '$app/environment';
import { firebaseConfigured, getFirebase } from '$lib/firebase';
import { logger } from '$lib/log';
import { authStore } from './auth.svelte';
import type { JobListing } from '../../routes/jobs/shared';

// self-host tracker bucket, mirroring scores.svelte.ts's LOCAL_HISTORY_KEY:
// when firebase is not configured, tracked applications persist to
// localStorage under this key so self-host installs get session-spanning
// tracking on the same device.
const LOCAL_APPLICATIONS_KEY = 'ats_local_applications_v1';

// namespaced by the signed-in AD user's stable subject in ldap mode, exactly
// like localHistoryKey() - two users sharing a browser don't see each
// other's tracked applications. bare key in anonymous 'none' mode.
function localApplicationsKey(): string {
	if (authStore.mode === 'ldap' && authStore.ldapSub) {
		return `${LOCAL_APPLICATIONS_KEY}__${authStore.ldapSub}`;
	}
	return LOCAL_APPLICATIONS_KEY;
}

function readLocalApplications(): TrackedApplication[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(localApplicationsKey());
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch (err) {
		logger.warn('tracker.local_read_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
		return [];
	}
}

function writeLocalApplications(entries: TrackedApplication[]): void {
	if (!browser) return;
	try {
		localStorage.setItem(localApplicationsKey(), JSON.stringify(entries));
	} catch (err) {
		// quota exceeded or storage disabled - in-memory list still works for
		// the current session, we just lose persistence. swallow so the
		// tracker flow does not break.
		logger.warn('tracker.local_write_failed', {
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

export type ApplicationStatus =
	'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'withdrawn';

export interface TrackedApplication {
	id: string;
	source: 'board' | 'manual';
	jobId: string | null;
	companyName: string;
	title: string;
	applyUrl: string | null;
	status: ApplicationStatus;
	notes: string;
	appliedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

// pure so it's directly unit-testable without going through the store's
// async load/save machinery. appliedAt marks "when this actually became a
// real application" - set the first time status moves past 'saved', then
// left untouched on every later transition (interviewing/offer/rejected
// don't each get their own timestamp in v1).
export function shouldSetAppliedAt(
	currentAppliedAt: string | null,
	nextStatus: ApplicationStatus
): boolean {
	return currentAppliedAt === null && nextStatus !== 'saved';
}

function generateLocalId(): string {
	return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class ApplicationsStore {
	applications = $state<TrackedApplication[]>([]);
	loading = $state(false);

	// newest-updated-first. sorted here (not relied on from insertion order)
	// because, unlike scan history, entries mutate in place (status/notes
	// edits bump updatedAt without changing their position in the array).
	get list(): TrackedApplication[] {
		return [...this.applications].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	async load() {
		if (!browser) return;

		if (!firebaseConfigured) {
			this.loading = true;
			this.applications = readLocalApplications();
			this.loading = false;
			return;
		}

		if (!authStore.isAuthenticated || !authStore.user) return;

		this.loading = true;
		try {
			const { db } = await getFirebase();
			const { collection, query, orderBy, getDocs } = await import('firebase/firestore');
			const appsRef = collection(db, 'users', authStore.user.uid, 'applications');
			const q = query(appsRef, orderBy('updatedAt', 'desc'));
			const snapshot = await getDocs(q);

			this.applications = snapshot.docs.map((d) => ({
				id: d.id,
				...(d.data() as Omit<TrackedApplication, 'id'>)
			}));
		} catch (err) {
			logger.warn('tracker.load_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
			this.applications = [];
		} finally {
			this.loading = false;
		}
	}

	// idempotent: checked against already-loaded state, never a blind write.
	// re-clicking "Save to Tracker" on a job that's already tracked must
	// never reset its status/notes back to a fresh 'saved' entry.
	async addFromBoard(job: JobListing): Promise<TrackedApplication | null> {
		const existing = this.applications.find((a) => a.id === job.id);
		if (existing) return existing;

		const now = new Date().toISOString();
		const entry: TrackedApplication = {
			id: job.id,
			source: 'board',
			jobId: job.id,
			companyName: job.companyName,
			title: job.title,
			applyUrl: job.applyUrl || null,
			status: 'saved',
			notes: '',
			appliedAt: null,
			createdAt: now,
			updatedAt: now
		};

		if (!firebaseConfigured) {
			const next = [entry, ...readLocalApplications()];
			writeLocalApplications(next);
			this.applications = next;
			return entry;
		}

		if (!authStore.isAuthenticated || !authStore.user) return null;

		try {
			const uid = authStore.user.uid;
			const { db } = await getFirebase();
			const { doc, setDoc } = await import('firebase/firestore');
			const { id, ...rest } = entry;
			const sanitized = JSON.parse(JSON.stringify(rest));
			await setDoc(doc(db, 'users', uid, 'applications', id), sanitized);
			this.applications = [entry, ...this.applications];
			return entry;
		} catch (err) {
			logger.error('tracker.add_from_board_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
			return null;
		}
	}

	async addManual(input: {
		companyName: string;
		title: string;
		applyUrl?: string;
		notes?: string;
		status: ApplicationStatus;
	}): Promise<TrackedApplication | null> {
		const now = new Date().toISOString();
		const base = {
			source: 'manual' as const,
			jobId: null,
			companyName: input.companyName,
			title: input.title,
			applyUrl: input.applyUrl?.trim() || null,
			status: input.status,
			notes: input.notes?.trim() ?? '',
			appliedAt: shouldSetAppliedAt(null, input.status) ? now : null,
			createdAt: now,
			updatedAt: now
		};

		if (!firebaseConfigured) {
			const entry: TrackedApplication = { id: generateLocalId(), ...base };
			const next = [entry, ...readLocalApplications()];
			writeLocalApplications(next);
			this.applications = next;
			return entry;
		}

		if (!authStore.isAuthenticated || !authStore.user) return null;

		try {
			const uid = authStore.user.uid;
			const { db } = await getFirebase();
			const { collection, addDoc } = await import('firebase/firestore');
			const appsRef = collection(db, 'users', uid, 'applications');
			const sanitized = JSON.parse(JSON.stringify(base));
			const docRef = await addDoc(appsRef, sanitized);
			const entry: TrackedApplication = { id: docRef.id, ...sanitized };
			this.applications = [entry, ...this.applications];
			return entry;
		} catch (err) {
			logger.error('tracker.add_manual_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
			return null;
		}
	}

	async updateStatus(id: string, status: ApplicationStatus) {
		const existing = this.applications.find((a) => a.id === id);
		if (!existing) return;
		const now = new Date().toISOString();
		const appliedAt = shouldSetAppliedAt(existing.appliedAt, status) ? now : existing.appliedAt;
		await this.patch(id, { status, appliedAt, updatedAt: now });
	}

	async updateNotes(id: string, notes: string) {
		await this.patch(id, { notes, updatedAt: new Date().toISOString() });
	}

	private async patch(id: string, changes: Partial<TrackedApplication>) {
		const existing = this.applications.find((a) => a.id === id);
		if (!existing) return;
		const updated: TrackedApplication = { ...existing, ...changes };

		if (!firebaseConfigured) {
			const next = readLocalApplications().map((a) => (a.id === id ? updated : a));
			writeLocalApplications(next);
			this.applications = next;
			return;
		}

		if (!authStore.isAuthenticated || !authStore.user) return;

		try {
			const uid = authStore.user.uid;
			const { db } = await getFirebase();
			const { doc, updateDoc } = await import('firebase/firestore');
			const sanitized = JSON.parse(JSON.stringify(changes));
			await updateDoc(doc(db, 'users', uid, 'applications', id), sanitized);
			this.applications = this.applications.map((a) => (a.id === id ? updated : a));
		} catch (err) {
			logger.error('tracker.update_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	async remove(id: string) {
		if (!firebaseConfigured) {
			const next = readLocalApplications().filter((a) => a.id !== id);
			writeLocalApplications(next);
			this.applications = next;
			return;
		}

		if (!authStore.isAuthenticated || !authStore.user) return;

		try {
			const uid = authStore.user.uid;
			const { db } = await getFirebase();
			const { doc, deleteDoc } = await import('firebase/firestore');
			await deleteDoc(doc(db, 'users', uid, 'applications', id));
			this.applications = this.applications.filter((a) => a.id !== id);
		} catch (err) {
			logger.error('tracker.remove_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// module-level singleton outlives any one component, same reasoning as
	// scoresStore.resetForSignOut() - without this, a second person signing
	// in on a shared browser tab would briefly see the previous account's
	// tracked applications.
	resetForSignOut() {
		this.applications = [];
	}
}

export const applicationsStore = new ApplicationsStore();
