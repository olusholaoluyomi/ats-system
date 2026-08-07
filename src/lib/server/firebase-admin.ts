// server-only. lazily initializes the firebase admin SDK for backend reads the
// client SDK cannot perform (e.g. the real count of auth users behind the
// landing page's "Users Served" counter). returns null until a service account
// is configured, so self-host deploys and local dev keep working without one —
// mirroring how firebaseConfigured guards the client SDK.
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { parseServiceAccount } from '$lib/server/service-account';

// getApps()/getAuth() dedupe across calls, so repeated requests reuse the one
// initialized app instead of re-running initializeApp (which throws on a
// duplicate init for the same project).
export function getAdminAuth(env: Record<string, string | undefined>): Auth | null {
	const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
	if (!creds) return null;
	if (getApps().length === 0) {
		initializeApp({
			credential: cert(creds),
			projectId: creds.projectId
		});
	}
	return getAuth();
}
