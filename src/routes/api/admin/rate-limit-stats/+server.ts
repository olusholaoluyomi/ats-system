import { json } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { requireAdminToken } from '$lib/server/admin-auth';
import { getRateLimitStats } from '../../analyze/rate-limiter';
import { getQuotaState } from '../../analyze/provider-quota';
import type { RequestHandler } from './$types';

// admin-only observability surface for the in-process rate-limiter.
// gated by ADMIN_TOKEN (see $lib/server/admin-auth) - no token configured
// server-side returns 503 so the endpoint cannot be exposed by accident,
// mismatched token returns 401. successful requests return the counter
// snapshot from rate-limiter.ts.
//
// the counters are per-instance and disappear on cold start, so this is
// best-effort, not authoritative. enough to spot abuse spikes in real
// time without spending a single byte of paid observability storage.
//
// rate-limiter itself is not exercised on this path; the request never
// reaches checkRateLimit, so admin polling does not consume an IP slot.
export const GET: RequestHandler = ({ request }) => {
	requireAdminToken(request, privateEnv);

	return json(
		{ ...getRateLimitStats(privateEnv), providerQuota: getQuotaState() },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
