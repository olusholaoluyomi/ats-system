import { error } from '@sveltejs/kit';

// shared ADMIN_TOKEN gate for every /api/admin/* route. fail-closed when no
// strong token is configured (503, so a misconfigured deploy is loud rather
// than silently exposing an admin surface); mismatched token is 401.
// extracted from rate-limit-stats/+server.ts's original inline check so new
// admin routes (job-analytics, companies) don't each reimplement it.
export function requireAdminToken(request: Request, env: Record<string, string | undefined>): void {
	const expected = env.ADMIN_TOKEN;
	if (!expected || expected.length < 16) {
		throw error(503, 'admin token not configured');
	}

	const provided = request.headers.get('x-admin-token') ?? '';
	// constant-time-ish comparison: short strings, no timing-attack stake here,
	// but use a length-checked equality anyway so a wrong-length probe does
	// not even touch the secret bytes.
	if (provided.length !== expected.length || provided !== expected) {
		throw error(401, 'unauthorized');
	}
}
