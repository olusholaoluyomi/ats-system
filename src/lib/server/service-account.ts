// server-only. parsing of the firebase service account for the admin SDK.
// kept pure (string in, creds out) so it unit-tests in isolation without
// importing firebase-admin, matching the resolveAuthMode() precedent.

export interface ServiceAccountCreds {
	projectId: string;
	clientEmail: string;
	privateKey: string;
}

// parse the FIREBASE_SERVICE_ACCOUNT env var: either the raw service-account
// JSON (as downloaded from Firebase console -> Project settings -> Service
// accounts -> Generate new private key) or its base64 form (a single line,
// which is safer to paste into a platform env-var editor). returns null when
// unset, blank, or not a valid service-account payload, so callers can treat
// it as "admin not configured" and degrade gracefully.
export function parseServiceAccount(raw: string | undefined): ServiceAccountCreds | null {
	if (!raw?.trim()) return null;
	const trimmed = raw.trim();
	const decoded = trimmed.startsWith('{')
		? trimmed
		: Buffer.from(trimmed, 'base64').toString('utf8');
	try {
		const parsed = JSON.parse(decoded);
		if (parsed.project_id && parsed.client_email && parsed.private_key) {
			return {
				projectId: parsed.project_id,
				clientEmail: parsed.client_email,
				privateKey: parsed.private_key
			};
		}
	} catch {
		// malformed: treat as unconfigured rather than crashing the request
	}
	return null;
}
