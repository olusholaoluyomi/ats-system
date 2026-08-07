// server-only. authoritative count of firebase auth users for the landing
// page's "Users Served" counter. the client SDK cannot enumerate accounts, so
// this walks the admin SDK's listUsers (1000/page). listUsers is quota-bound
// and the landing page is high-traffic, so the result is cached in-process
// with a single-flight refresh: concurrent requests share one listUsers walk
// instead of stampeding the identity toolkit API.
import type { Auth } from 'firebase-admin/auth';

export const USERS_PAGE_SIZE = 1000;
export const USER_COUNT_CACHE_TTL_MS = 5 * 60 * 1000;

// walks every page of auth users. pageToken is absent on the last page, so
// the loop terminates exactly once all accounts have been counted.
export async function countAuthUsers(auth: Auth): Promise<number> {
	let count = 0;
	let nextPageToken: string | undefined;
	do {
		const result = await auth.listUsers(USERS_PAGE_SIZE, nextPageToken);
		count += result.users.length;
		nextPageToken = result.pageToken;
	} while (nextPageToken);
	return count;
}

export interface UserCountCache {
	get(auth: Auth): Promise<number>;
}

export function createUserCountCache(
	ttlMs: number = USER_COUNT_CACHE_TTL_MS,
	now: () => number = Date.now
): UserCountCache {
	let cached: { at: number; count: number } | null = null;
	let inflight: Promise<number> | null = null;

	return {
		async get(auth: Auth): Promise<number> {
			if (cached && now() - cached.at < ttlMs) return cached.count;
			if (!inflight) {
				inflight = countAuthUsers(auth)
					.then((count) => {
						cached = { at: now(), count };
						return count;
					})
					.finally(() => {
						inflight = null;
					});
			}
			return inflight;
		}
	};
}

export const userCountCache = createUserCountCache();
