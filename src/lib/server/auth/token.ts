// server-side verification of the client's firebase ID token (sent as
// `Authorization: Bearer <idToken>`). this is how the payment/billing routes
// and the analyze gate learn the caller's uid without trusting anything the
// client asserts. returns null on any failure so callers fail closed (401).
//
// firebase-admin is loaded via dynamic import, mirroring /api/stats: a static
// import would pull the heavy admin SDK into the bundle at module evaluation
// time and could throw before any handler runs. the type-only import below is
// erased at compile time, so this module itself stays lightweight.
import type { Auth } from 'firebase-admin/auth';

export interface VerifiedIdentity {
	uid: string;
	email: string | null;
}

export async function verifyFirebaseIdToken(
	env: Record<string, string | undefined>,
	authorizationHeader: string | null | undefined
): Promise<VerifiedIdentity | null> {
	if (!authorizationHeader) return null;
	const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
	if (!match) return null;

	try {
		const { getAdminAuth } = await import('$lib/server/firebase-admin');
		const auth: Auth | null = getAdminAuth(env);
		if (!auth) return null;
		const decoded = await auth.verifyIdToken(match[1]);
		return {
			uid: decoded.uid,
			email: typeof decoded.email === 'string' ? decoded.email : null
		};
	} catch {
		// expired/malformed token, revoked user, or admin SDK not configured.
		// treat all as "not authenticated" rather than leaking the reason.
		return null;
	}
}
