import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// regression tests for the email/password auth flow. two historical bugs:
//  1. getFirebase() / firebase SDK imports were awaited OUTSIDE the try/catch,
//     so a rejected firebase init propagated to the caller uncaught with
//     authStore.error left null. the login page swallows that rejection
//     ("error is set in authStore"), so the Create Account button silently did
//     nothing — no error banner, no feedback.
//  2. the common "Email/Password sign-in is not enabled" error codes
//     (operation-not-allowed / admin-restricted-operation) fell through to the
//     generic "Authentication error (auth/...)" message, hiding the real fix.

type FirestoreLib = {
	firebaseConfigured: boolean;
	getFirebase: ReturnType<typeof vi.fn>;
};

let firestoreLib: FirestoreLib;

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
}

function mockFirebaseAuth(): void {
	vi.doMock('firebase/auth', () => ({
		onAuthStateChanged: vi.fn(),
		getRedirectResult: vi.fn().mockResolvedValue(null),
		getAdditionalUserInfo: vi.fn(),
		signInWithEmailAndPassword: vi.fn(),
		createUserWithEmailAndPassword: vi.fn(),
		updateProfile: vi.fn().mockResolvedValue(undefined),
		sendEmailVerification: vi.fn().mockResolvedValue(undefined),
		sendPasswordResetEmail: vi.fn(),
		signOut: vi.fn(),
		validatePassword: vi
			.fn()
			.mockResolvedValue({ isValid: true, passwordPolicy: { customStrengthOptions: {} } }),
		GoogleAuthProvider: vi.fn(),
		signInWithPopup: vi.fn(),
		signInWithRedirect: vi.fn()
	}));
	// incrementUserCount() imports firebase/firestore after a successful signup;
	// keep the real SDK out so the fake { db } handle never reaches it.
	vi.doMock('firebase/firestore', () => ({
		doc: vi.fn(),
		setDoc: vi.fn().mockResolvedValue(undefined),
		increment: vi.fn((n: number) => n)
	}));
}

async function authMethodWithCode(method: 'signInWithEmail', code: string): Promise<string | null> {
	mockFirebaseModule({
		configured: true,
		getFirebase: () => Promise.resolve({ auth: {}, db: {} })
	});
	mockFirebaseAuth();
	const { authStore } = await import('../../../src/lib/stores/auth.svelte');
	const { signInWithEmailAndPassword } = await import('firebase/auth');
	(signInWithEmailAndPassword as ReturnType<typeof vi.fn>).mockRejectedValue({ code });
	await expect(authStore.signInWithEmail('user@example.com', 'password')).rejects.toBeTruthy();
	return authStore.error;
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe('auth store: firebase init failure surfaces an error (was a silent dead button)', () => {
	it('signUpWithEmail sets authStore.error and rethrows when getFirebase rejects', async () => {
		mockFirebaseModule({ configured: true });
		mockFirebaseAuth();
		const { authStore } = await import('../../../src/lib/stores/auth.svelte');

		await expect(
			authStore.signUpWithEmail('user@example.com', 'secret1', 'A User')
		).rejects.toBeTruthy();
		expect(authStore.error).toBeTruthy();
	});

	it('signInWithEmail sets authStore.error and rethrows when getFirebase rejects', async () => {
		mockFirebaseModule({ configured: true });
		mockFirebaseAuth();
		const { authStore } = await import('../../../src/lib/stores/auth.svelte');

		await expect(authStore.signInWithEmail('user@example.com', 'password')).rejects.toBeTruthy();
		expect(authStore.error).toBeTruthy();
	});

	it('sendPasswordReset sets authStore.error and rethrows when getFirebase rejects', async () => {
		mockFirebaseModule({ configured: true });
		mockFirebaseAuth();
		const { authStore } = await import('../../../src/lib/stores/auth.svelte');

		await expect(authStore.sendPasswordReset('user@example.com')).rejects.toBeTruthy();
		expect(authStore.error).toBeTruthy();
	});
});

describe('auth store: error-code mappings for email/password failures', () => {
	it('maps auth/operation-not-allowed to an actionable message', async () => {
		const error = await authMethodWithCode('signInWithEmail', 'auth/operation-not-allowed');
		expect(error).toMatch(/not enabled/i);
	});

	it('maps auth/admin-restricted-operation to an actionable message', async () => {
		const error = await authMethodWithCode('signInWithEmail', 'auth/admin-restricted-operation');
		expect(error).toMatch(/not enabled/i);
	});

	it('maps auth/network-request-failed to a network message', async () => {
		const error = await authMethodWithCode('signInWithEmail', 'auth/network-request-failed');
		expect(error).toMatch(/network/i);
	});

	it('signUpWithEmail maps auth/admin-restricted-operation through createUserWithEmailAndPassword', async () => {
		mockFirebaseModule({
			configured: true,
			getFirebase: () => Promise.resolve({ auth: {}, db: {} })
		});
		mockFirebaseAuth();
		const { authStore } = await import('../../../src/lib/stores/auth.svelte');
		const { createUserWithEmailAndPassword } = await import('firebase/auth');
		(createUserWithEmailAndPassword as ReturnType<typeof vi.fn>).mockRejectedValue({
			code: 'auth/admin-restricted-operation'
		});

		await expect(
			authStore.signUpWithEmail('user@example.com', 'secret1', 'A User')
		).rejects.toBeTruthy();
		expect(authStore.error).toMatch(/not enabled/i);
	});

	it('rejects a weak password client-side before hitting createUserWithEmailAndPassword', async () => {
		mockFirebaseModule({
			configured: true,
			getFirebase: () => Promise.resolve({ auth: {}, db: {} })
		});
		mockFirebaseAuth();
		const { authStore } = await import('../../../src/lib/stores/auth.svelte');
		const { validatePassword, createUserWithEmailAndPassword } = await import('firebase/auth');
		(validatePassword as ReturnType<typeof vi.fn>).mockResolvedValue({
			isValid: false,
			meetsMinPasswordLength: false,
			containsUppercaseLetter: false,
			passwordPolicy: {
				customStrengthOptions: { minPasswordLength: 8, containsUppercaseLetter: true }
			}
		});

		await expect(
			authStore.signUpWithEmail('user@example.com', 'short', 'A User')
		).rejects.toBeTruthy();
		expect(authStore.error).toMatch(/at least 8 characters/);
		expect(authStore.error).toMatch(/uppercase letter/);
		// the backend account-creation call must never have been attempted
		expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
	});

	it('accepts a password that passes validatePassword', async () => {
		mockFirebaseModule({
			configured: true,
			getFirebase: () => Promise.resolve({ auth: {}, db: {} })
		});
		mockFirebaseAuth();
		const { authStore } = await import('../../../src/lib/stores/auth.svelte');
		const { validatePassword, createUserWithEmailAndPassword } = await import('firebase/auth');
		(validatePassword as ReturnType<typeof vi.fn>).mockResolvedValue({
			isValid: true,
			passwordPolicy: { customStrengthOptions: {} }
		});
		(createUserWithEmailAndPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
			user: { displayName: '' }
		});

		await authStore.signUpWithEmail('user@example.com', 'StrongPass1!', 'A User');
		expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
		expect(authStore.error).toBeNull();
	});

	it('counts the new user with setDoc(merge:true) so a missing insights doc does not zero the counter', async () => {
		mockFirebaseModule({
			configured: true,
			getFirebase: () => Promise.resolve({ auth: {}, db: {} })
		});
		mockFirebaseAuth();
		const { authStore } = await import('../../../src/lib/stores/auth.svelte');
		const { validatePassword, createUserWithEmailAndPassword } = await import('firebase/auth');
		(validatePassword as ReturnType<typeof vi.fn>).mockResolvedValue({
			isValid: true,
			passwordPolicy: { customStrengthOptions: {} }
		});
		(createUserWithEmailAndPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
			user: { displayName: '' }
		});
		const { setDoc } = await import('firebase/firestore');

		await authStore.signUpWithEmail('user@example.com', 'StrongPass1!', 'A User');
		// incrementUserCount is intentionally fire-and-forget (non-critical), so
		// flush the pending microtasks before asserting.
		await vi.waitFor(() => {
			expect(setDoc).toHaveBeenCalledTimes(1);
		});
		const [, data, options] = (setDoc as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(options).toEqual({ merge: true });
		expect(data).toEqual({ userCount: 1 });
		expect(authStore.error).toBeNull();
	});
});
