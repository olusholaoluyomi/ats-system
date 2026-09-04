import { describe, expect, it } from 'vitest';
import { requireAdminToken } from '../../../src/lib/server/admin-auth';

function requestWith(token: string | null): Request {
	const headers = new Headers();
	if (token !== null) headers.set('x-admin-token', token);
	return new Request('https://example.com', { headers });
}

const STRONG_TOKEN = 'a'.repeat(32);

describe('requireAdminToken', () => {
	it('throws 503 when ADMIN_TOKEN is unset', () => {
		expect(() => requireAdminToken(requestWith(STRONG_TOKEN), {})).toThrowError(
			expect.objectContaining({ status: 503 })
		);
	});

	it('throws 503 when ADMIN_TOKEN is shorter than 16 chars', () => {
		expect(() => requireAdminToken(requestWith('short'), { ADMIN_TOKEN: 'short' })).toThrowError(
			expect.objectContaining({ status: 503 })
		);
	});

	it('throws 401 when no token header is sent', () => {
		expect(() => requireAdminToken(requestWith(null), { ADMIN_TOKEN: STRONG_TOKEN })).toThrowError(
			expect.objectContaining({ status: 401 })
		);
	});

	it('throws 401 when the token does not match', () => {
		expect(() =>
			requireAdminToken(requestWith('b'.repeat(32)), { ADMIN_TOKEN: STRONG_TOKEN })
		).toThrowError(expect.objectContaining({ status: 401 }));
	});

	it('throws 401 for a wrong-length token without touching the secret bytes', () => {
		expect(() =>
			requireAdminToken(requestWith(STRONG_TOKEN + 'x'), { ADMIN_TOKEN: STRONG_TOKEN })
		).toThrowError(expect.objectContaining({ status: 401 }));
	});

	it('does not throw when the token matches exactly', () => {
		expect(() =>
			requireAdminToken(requestWith(STRONG_TOKEN), { ADMIN_TOKEN: STRONG_TOKEN })
		).not.toThrow();
	});
});
