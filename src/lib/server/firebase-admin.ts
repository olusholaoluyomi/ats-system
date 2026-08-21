// server-only. lazily initializes the firebase admin SDK for backend reads the
// client SDK cannot perform (e.g. the real count of auth users behind the
// landing page's "Users Served" counter, or the insights/global doc backing
// "Resumes Analyzed"). returns null until a service account is configured, so
// self-host deploys and local dev keep working without one — mirroring how
// firebaseConfigured guards the client SDK.
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { parseServiceAccount } from '$lib/server/service-account';
import type { Firestore } from 'firebase-admin/firestore';

// getApps()/getAuth() dedupe across calls, so repeated requests reuse the one
// initialized app instead of re-running initializeApp (which throws on a
// duplicate init for the same project).
export function getAdminAuth(env: Record<string, string | undefined>): Auth | null {
	if (!ensureAdminApp(env)) return null;
	return getAuth();
}

// admin firestore handle for the project's custom-named 'default' database
// (the same one the client SDK addresses explicitly). firestore is heavy, so
// it is loaded lazily behind a dynamic import and only pulled in by endpoints
// that actually read it.
export async function getAdminFirestore(
	env: Record<string, string | undefined>
): Promise<Firestore | null> {
	if (!ensureAdminApp(env)) return null;
	const { getFirestore } = await import('firebase-admin/firestore');
	return getFirestore(getApp(), 'default');
}

function ensureAdminApp(env: Record<string, string | undefined>): boolean {
	const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
	if (!creds) {
		console.error('Firebase Admin: Failed to parse FIREBASE_SERVICE_ACCOUNT env var');
		console.error('Env var present:', !!env.FIREBASE_SERVICE_ACCOUNT);
		console.error('Env var length:', env.FIREBASE_SERVICE_ACCOUNT?.length || 0);
		return false;
	}
	if (getApps().length === 0) {
		try {
			initializeApp({
				credential: cert(creds),
				projectId: creds.projectId
			});
		} catch (error) {
			console.error('Firebase Admin: Failed to initialize app:', error);
			return false;
		}
	}
	return true;
}
