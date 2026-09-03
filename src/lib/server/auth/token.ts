// server-side verification of the client's firebase ID token (sent as
// `Authorization: Bearer <idToken>`). this is how the payment/billing routes
// and the analyze gate learn the caller's uid without trusting anything the
// client asserts.
//
// firebase-admin is loaded via dynamic import, mirroring /api/stats: a static
// import would pull the heavy admin SDK into the bundle at module evaluation
// time and could throw before any handler runs. the type-only import below is
// erased at compile time, so this module itself stays lightweight.
import type { Auth } from 'firebase-admin/auth';
import { json } from '@sveltejs/kit';

export interface VerifiedIdentity {
	uid: string;
	email: string | null;
}

// thrown when the failure isn't about the token itself (a real "you're not
// signed in") but about the verification path being broken: admin SDK not
// initialized, or a verifyIdToken() failure that isn't a recognized `auth/*`
// error (e.g. a network blip fetching Google's signing keys). callers must
// surface this as a transient 503, not a 401 - a 401 here previously got
// collapsed into the same bucket as "not authenticated" and sent still
// signed-in users straight to /login on nothing more than a server hiccup.
export class AuthServiceUnavailableError extends Error {}

export async function verifyFirebaseIdToken(
	env: Record<string, string | undefined>,
	authorizationHeader: string | null | undefined
): Promise<VerifiedIdentity | null> {
	if (!authorizationHeader) return null;
	const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
	if (!match) return null;

	const { getAdminAuth } = await import('$lib/server/firebase-admin');
	const auth: Auth | null = getAdminAuth(env);
	if (!auth) {
		throw new AuthServiceUnavailableError('firebase admin auth is not configured');
	}

	try {
		const decoded = await auth.verifyIdToken(match[1]);
		return {
			uid: decoded.uid,
			email: typeof decoded.email === 'string' ? decoded.email : null
		};
	} catch (err) {
		const code = (err as { code?: unknown } | null)?.code;
		if (typeof code === 'string' && code.startsWith('auth/')) {
			// genuine token problem: expired, malformed, revoked user, etc.
			return null;
		}
		throw new AuthServiceUnavailableError('token verification failed transiently');
	}
}

// convenience for route handlers: resolves to the caller's identity, or an
// error Response to return as-is - a 401 when the caller really isn't
// authenticated, a 503 when the auth service itself is unavailable. keeping
// those distinct is what lets the client's retry logic tell "refresh your
// token and try again" apart from "you're actually logged out".
export async function requireFirebaseIdentity(
	env: Record<string, string | undefined>,
	authorizationHeader: string | null | undefined
): Promise<{ identity: VerifiedIdentity } | { response: Response }> {
	try {
		const identity = await verifyFirebaseIdToken(env, authorizationHeader);
		if (!identity) {
			return { response: json({ error: 'authentication required' }, { status: 401 }) };
		}
		return { identity };
	} catch (err) {
		if (err instanceof AuthServiceUnavailableError) {
			return {
				response: json({ error: 'authentication service temporarily unavailable' }, { status: 503 })
			};
		}
		throw err;
	}
}
