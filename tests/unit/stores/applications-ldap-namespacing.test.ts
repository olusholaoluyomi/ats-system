import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ldap self-host mode reuses the localStorage tracker path (firebase is not
// configured) but namespaces the bucket by the signed-in AD user's stable
// subject. mocks mirror scores-ldap-history-namespacing.test.ts.

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('../../../src/lib/log', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));

const BARE_KEY = 'ats_local_applications_v1';
const SUB = 'guid-deadbeef';
const NS_KEY = `${BARE_KEY}__${SUB}`;

function readKey(key: string): unknown[] {
	const raw = localStorage.getItem(key);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function freshGraph() {
	vi.resetModules();
	const { authStore } = await import('../../../src/lib/stores/auth.svelte');
	const { applicationsStore } = await import('../../../src/lib/stores/applications.svelte');
	return { authStore, applicationsStore };
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	localStorage.clear();
});

describe('ldap mode: tracked applications namespaced by AD subject', () => {
	it('writes applications under a per-user key, leaving the anonymous bucket untouched', async () => {
		const { authStore, applicationsStore } = await freshGraph();
		authStore.hydrateFromServer({
			authMode: 'ldap',
			user: { sub: SUB, name: 'Jane Doe', email: 'jane@corp.local', groups: [] }
		});
		await applicationsStore.addManual({ companyName: 'Corp', title: 'Role', status: 'applied' });

		expect(readKey(NS_KEY)).toHaveLength(1);
		expect(readKey(BARE_KEY)).toEqual([]);
	});

	it('keeps two AD users on the same browser in separate buckets', async () => {
		const { authStore, applicationsStore } = await freshGraph();

		authStore.hydrateFromServer({
			authMode: 'ldap',
			user: { sub: 'guid-aaa', name: 'A', email: '', groups: [] }
		});
		await applicationsStore.addManual({ companyName: 'A Co', title: 'A role', status: 'applied' });

		authStore.hydrateFromServer({
			authMode: 'ldap',
			user: { sub: 'guid-bbb', name: 'B', email: '', groups: [] }
		});
		await applicationsStore.addManual({ companyName: 'B Co', title: 'B role', status: 'applied' });

		expect(readKey(`${BARE_KEY}__guid-aaa`)).toHaveLength(1);
		expect(readKey(`${BARE_KEY}__guid-bbb`)).toHaveLength(1);
		expect(readKey(BARE_KEY)).toEqual([]);
	});

	it('anonymous (none) mode still uses the bare legacy key', async () => {
		const { authStore, applicationsStore } = await freshGraph();
		expect(authStore.mode).toBe('none');
		await applicationsStore.addManual({ companyName: 'Anon Co', title: 'Role', status: 'applied' });

		expect(readKey(BARE_KEY)).toHaveLength(1);
	});
});
