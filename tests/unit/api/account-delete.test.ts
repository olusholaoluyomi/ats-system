import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$lib/log', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

let authMode: string = 'firebase';
vi.mock('$lib/server/auth/config', () => ({
	resolveAuthMode: vi.fn(() => authMode)
}));

let identityResult: unknown = { identity: { uid: 'u1', email: 'u1@x.com' } };
vi.mock('$lib/server/auth/token', () => ({
	requireFirebaseIdentity: vi.fn(() => identityResult)
}));

const mockDeleteUser = vi.fn();
const mockRecursiveDelete = vi.fn();
const mockRunTransaction = vi.fn();
const mockDoc = vi.fn((path: string) => ({ path }));
const mockCollection = vi.fn((path: string) => ({ path }));
let adminAuth: { deleteUser: typeof mockDeleteUser } | null = null;
let adminDb: {
	doc: typeof mockDoc;
	collection: typeof mockCollection;
	recursiveDelete: typeof mockRecursiveDelete;
	runTransaction: (fn: (tx: { set: ReturnType<typeof vi.fn> }) => unknown) => unknown;
} | null = null;

vi.mock('$lib/server/firebase-admin', () => ({
	getAdminAuth: vi.fn(() => adminAuth),
	getAdminFirestore: vi.fn(() => Promise.resolve(adminDb))
}));

// the generated RequestHandler type ties `request` to this route's exact
// RouteId, which a hand-built test fixture can't satisfy - the handler only
// ever reads `request.headers` and calls `getClientAddress()`, so a minimal
// object covers what it uses.
function fakeRequest() {
	return {
		request: { headers: new Headers({ authorization: 'Bearer good-token' }) },
		getClientAddress: () => '203.0.113.1'
	} as unknown as Parameters<
		typeof import('../../../src/routes/api/account/delete/+server').POST
	>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	authMode = 'firebase';
	identityResult = { identity: { uid: 'u1', email: 'u1@x.com' } };
	adminAuth = { deleteUser: mockDeleteUser };
	adminDb = {
		doc: mockDoc,
		collection: mockCollection,
		recursiveDelete: mockRecursiveDelete,
		runTransaction: (fn) => {
			mockRunTransaction();
			return fn({ set: vi.fn() });
		}
	};
	mockDeleteUser.mockResolvedValue(undefined);
	mockRecursiveDelete.mockResolvedValue(undefined);
});

describe('POST /api/account/delete', () => {
	it('rejects when auth mode is not firebase', async () => {
		authMode = 'none';
		const { POST } = await import('../../../src/routes/api/account/delete/+server');
		const res = await POST(fakeRequest());
		expect(res.status).toBe(400);
	});

	it('passes through the 401 from requireFirebaseIdentity when unauthenticated', async () => {
		identityResult = {
			response: new Response(JSON.stringify({ error: 'authentication required' }), { status: 401 })
		};
		const { POST } = await import('../../../src/routes/api/account/delete/+server');
		const res = await POST(fakeRequest());
		expect(res.status).toBe(401);
	});

	it('returns 503 when admin services are not configured', async () => {
		adminAuth = null;
		const { POST } = await import('../../../src/routes/api/account/delete/+server');
		const res = await POST(fakeRequest());
		expect(res.status).toBe(503);
	});

	it('recursively deletes the scans collection (not a doc path) and deletes the auth user', async () => {
		const { POST } = await import('../../../src/routes/api/account/delete/+server');
		const res = await POST(fakeRequest());

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true });

		// this is the regression check: scans must be addressed as a collection
		// (even path-segment count) so db.recursiveDelete can walk it, not as
		// db.doc() on an odd-segment path, which throws synchronously.
		expect(mockCollection).toHaveBeenCalledWith('users/u1/scans');
		expect(mockRecursiveDelete).toHaveBeenCalledWith({ path: 'users/u1/scans' });
		expect(mockDoc).toHaveBeenCalledWith('users/u1/billing/state');
		expect(mockRunTransaction).toHaveBeenCalled();
		expect(mockDeleteUser).toHaveBeenCalledWith('u1');
	});

	it('returns 500 and does not delete the auth user if recursiveDelete fails', async () => {
		mockRecursiveDelete.mockRejectedValue(new Error('firestore unavailable'));
		const { POST } = await import('../../../src/routes/api/account/delete/+server');
		const res = await POST(fakeRequest());

		expect(res.status).toBe(500);
		expect(mockDeleteUser).not.toHaveBeenCalled();
	});
});
