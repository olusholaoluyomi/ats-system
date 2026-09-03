import { describe, expect, it, vi, beforeEach } from 'vitest';

// getAdminAuth is swapped out per-test via the `adminAuth` closure variable so
// we can drive both "admin sdk unavailable" (null) and "admin sdk returns a
// fake Auth" paths without needing a real firebase-admin instance.
const mockVerifyIdToken = vi.fn();
let adminAuth: { verifyIdToken: typeof mockVerifyIdToken } | null = null;

vi.mock('$lib/server/firebase-admin', () => ({
	getAdminAuth: vi.fn(() => adminAuth)
}));

import {
	verifyFirebaseIdToken,
	requireFirebaseIdentity,
	AuthServiceUnavailableError
} from '$lib/server/auth/token';

beforeEach(() => {
	mockVerifyIdToken.mockReset();
	adminAuth = { verifyIdToken: mockVerifyIdToken };
});

describe('verifyFirebaseIdToken', () => {
	it('returns null when there is no authorization header', async () => {
		await expect(verifyFirebaseIdToken({}, null)).resolves.toBeNull();
	});

	it('returns null when the header is not a Bearer token', async () => {
		await expect(verifyFirebaseIdToken({}, 'Basic dXNlcjpwYXNz')).resolves.toBeNull();
	});

	it('returns the identity for a valid token', async () => {
		mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'a@b.com' });
		await expect(verifyFirebaseIdToken({}, 'Bearer good-token')).resolves.toEqual({
			uid: 'u1',
			email: 'a@b.com'
		});
	});

	it('returns null for a recognized auth/* failure (expired token)', async () => {
		mockVerifyIdToken.mockRejectedValue(
			Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
		);
		await expect(verifyFirebaseIdToken({}, 'Bearer stale-token')).resolves.toBeNull();
	});

	it('returns null for a revoked/disabled-user auth/* failure', async () => {
		mockVerifyIdToken.mockRejectedValue(
			Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' })
		);
		await expect(verifyFirebaseIdToken({}, 'Bearer revoked-token')).resolves.toBeNull();
	});

	it('throws AuthServiceUnavailableError when the admin SDK is not configured', async () => {
		adminAuth = null;
		await expect(verifyFirebaseIdToken({}, 'Bearer any-token')).rejects.toBeInstanceOf(
			AuthServiceUnavailableError
		);
	});

	it('throws AuthServiceUnavailableError for an unrecognized verification failure', async () => {
		// e.g. a network blip fetching Google's signing keys - not a real "you're
		// logged out" and must not be collapsed into the same 401 as one.
		mockVerifyIdToken.mockRejectedValue(new Error('ECONNRESET'));
		await expect(verifyFirebaseIdToken({}, 'Bearer any-token')).rejects.toBeInstanceOf(
			AuthServiceUnavailableError
		);
	});
});

describe('requireFirebaseIdentity', () => {
	it('resolves the identity when the token is valid', async () => {
		mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: null });
		const result = await requireFirebaseIdentity({}, 'Bearer good-token');
		expect('identity' in result && result.identity).toEqual({ uid: 'u1', email: null });
	});

	it('resolves a 401 response when the caller is not authenticated', async () => {
		const result = await requireFirebaseIdentity({}, null);
		expect('response' in result && result.response.status).toBe(401);
	});

	it('resolves a 503 response (not 401) when the auth service itself is unavailable', async () => {
		adminAuth = null;
		const result = await requireFirebaseIdentity({}, 'Bearer any-token');
		expect('response' in result && result.response.status).toBe(503);
	});
});
