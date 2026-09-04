import { browser } from '$app/environment';
import { firebaseConfigured, getFirebase } from '$lib/firebase';
import { logger } from '$lib/log';
import { authStore } from './auth.svelte';

// notifications are written by scripts/notify-matches.mjs via the admin SDK
// (see that script's own comment). there is no localStorage fallback here,
// unlike applications.svelte.ts/profile.svelte.ts - self-host installs
// (firebase not configured) have no ingestion pipeline writing these in the
// first place, so this store is simply inert (empty list, no-op load) when
// firebaseConfigured is false.
export interface JobNotification {
	id: string;
	jobId: string;
	title: string;
	companyName: string;
	createdAt: string;
	read: boolean;
}

class NotificationsStore {
	notifications = $state<JobNotification[]>([]);
	loading = $state(false);

	get unreadCount(): number {
		return this.notifications.filter((n) => !n.read).length;
	}

	async load() {
		if (!browser || !firebaseConfigured) return;
		if (!authStore.isAuthenticated || !authStore.user) return;

		this.loading = true;
		try {
			const uid = authStore.user.uid;
			const { db } = await getFirebase();
			const { collection, query, orderBy, limit, getDocs } = await import('firebase/firestore');
			const ref = collection(db, 'users', uid, 'notifications');
			// most-recent-first, capped - this is a lightweight recent-activity
			// feed, not a full archive.
			const q = query(ref, orderBy('createdAt', 'desc'), limit(50));
			const snapshot = await getDocs(q);

			this.notifications = snapshot.docs.map((d) => {
				const data = d.data();
				return {
					id: d.id,
					jobId: typeof data.jobId === 'string' ? data.jobId : '',
					title: typeof data.title === 'string' ? data.title : '',
					companyName: typeof data.companyName === 'string' ? data.companyName : '',
					createdAt:
						data.createdAt && typeof data.createdAt.toDate === 'function'
							? data.createdAt.toDate().toISOString()
							: new Date(0).toISOString(),
					read: data.read === true
				};
			});
		} catch (err) {
			logger.warn('notifications.load_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
			this.notifications = [];
		} finally {
			this.loading = false;
		}
	}

	async markRead(id: string) {
		const existing = this.notifications.find((n) => n.id === id);
		if (!existing || existing.read) return;

		this.notifications = this.notifications.map((n) => (n.id === id ? { ...n, read: true } : n));

		if (!firebaseConfigured || !authStore.isAuthenticated || !authStore.user) return;
		try {
			const uid = authStore.user.uid;
			const { db } = await getFirebase();
			const { doc, updateDoc } = await import('firebase/firestore');
			await updateDoc(doc(db, 'users', uid, 'notifications', id), { read: true });
		} catch (err) {
			logger.error('notifications.mark_read_failed', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	async markAllRead() {
		const unread = this.notifications.filter((n) => !n.read);
		if (unread.length === 0) return;
		await Promise.all(unread.map((n) => this.markRead(n.id)));
	}

	// module-level singleton outlives any one component, same reasoning as
	// applicationsStore.resetForSignOut().
	resetForSignOut() {
		this.notifications = [];
	}
}

export const notificationsStore = new NotificationsStore();
