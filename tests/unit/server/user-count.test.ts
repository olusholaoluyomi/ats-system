import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from 'firebase-admin/auth';

// isolates firebase-admin/auth so countAuthUsers / the cache can be tested
// against a mock listUsers instead of a live project.
vi.mock('firebase-admin/auth', () => ({
	getAuth: vi.fn(() => mockAuth)
}));

let mockAuth: Auth;
let mockListUsers: ReturnType<typeof vi.fn>;

function createAuth(
	usersByPage: Record<string, { users: { uid: string }[]; pageToken?: string }>
): void {
	mockListUsers = vi.fn((_max: number, token?: string) => {
		const page = usersByPage[token ?? ''];
		return Promise.resolve({
			users: page.users,
			pageToken: page.pageToken ?? undefined
		});
	});
	mockAuth = { listUsers: mockListUsers } as unknown as Auth;
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('countAuthUsers', () => {
	it('counts users across multiple listUsers pages', async () => {
		createAuth({
			'': { users: Array.from({ length: 2 }, (_, i) => ({ uid: `a${i}` })), pageToken: 'p1' },
			p1: { users: Array.from({ length: 3 }, (_, i) => ({ uid: `b${i}` })) }
		});
		const { countAuthUsers } = await import('$lib/server/user-count');
		await expect(countAuthUsers(mockAuth)).resolves.toBe(5);
		expect(mockListUsers).toHaveBeenCalledTimes(2);
	});

	it('counts zero users on an empty project', async () => {
		createAuth({ '': { users: [] } });
		const { countAuthUsers } = await import('$lib/server/user-count');
		await expect(countAuthUsers(mockAuth)).resolves.toBe(0);
		expect(mockListUsers).toHaveBeenCalledTimes(1);
	});
});

describe('createUserCountCache', () => {
	it('caches the count within the TTL and skips listUsers', async () => {
		createAuth({
			'': { users: Array.from({ length: 7 }, (_, i) => ({ uid: `a${i}` })) }
		});
		const { createUserCountCache } = await import('$lib/server/user-count');
		const now = vi.spyOn(Date, 'now');
		now.mockReturnValue(0);
		const cache = createUserCountCache(1000, () => now());

		await expect(cache.get(mockAuth)).resolves.toBe(7);
		await expect(cache.get(mockAuth)).resolves.toBe(7);
		expect(mockListUsers).toHaveBeenCalledTimes(1);

		now.mockReturnValue(500);
		await expect(cache.get(mockAuth)).resolves.toBe(7);
		expect(mockListUsers).toHaveBeenCalledTimes(1);

		now.mockReturnValue(1001);
		await expect(cache.get(mockAuth)).resolves.toBe(7);
		expect(mockListUsers).toHaveBeenCalledTimes(2);
	});

	it('coalesces concurrent in-flight requests into one listUsers walk', async () => {
		createAuth({
			'': { users: Array.from({ length: 3 }, (_, i) => ({ uid: `a${i}` })) }
		});
		const { createUserCountCache } = await import('$lib/server/user-count');
		const cache = createUserCountCache(1000, () => 0);

		const results = await Promise.all([
			cache.get(mockAuth),
			cache.get(mockAuth),
			cache.get(mockAuth)
		]);
		expect(results).toEqual([3, 3, 3]);
		expect(mockListUsers).toHaveBeenCalledTimes(1);
	});

	it('re-counts after a failed walk instead of caching the failure', async () => {
		const { createUserCountCache } = await import('$lib/server/user-count');
		const cache = createUserCountCache(1000, () => 0);

		mockListUsers = vi.fn();
		mockAuth = { listUsers: mockListUsers } as unknown as Auth;
		mockListUsers.mockRejectedValueOnce(new Error('quota exceeded'));
		await expect(cache.get(mockAuth)).rejects.toThrow('quota exceeded');

		mockListUsers.mockResolvedValue({
			users: Array.from({ length: 2 }, (_, i) => ({ uid: `a${i}` })),
			pageToken: undefined
		});
		await expect(cache.get(mockAuth)).resolves.toBe(2);
		expect(mockListUsers).toHaveBeenCalledTimes(2);
	});
});
