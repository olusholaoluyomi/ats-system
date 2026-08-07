import { describe, expect, it } from 'vitest';
import { parseServiceAccount } from '$lib/server/service-account';

describe('parseServiceAccount', () => {
	it('parses a raw service-account JSON payload', () => {
		const creds = parseServiceAccount(
			JSON.stringify({
				type: 'service_account',
				project_id: 'ats-screener',
				client_email: 'admin@ats-screener.iam.gserviceaccount.com',
				private_key: '-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----'
			})
		);
		expect(creds).toEqual({
			projectId: 'ats-screener',
			clientEmail: 'admin@ats-screener.iam.gserviceaccount.com',
			privateKey: '-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----'
		});
	});

	it('parses a base64-encoded service-account payload', () => {
		const raw = JSON.stringify({
			project_id: 'ats-screener',
			client_email: 'admin@ats-screener.iam.gserviceaccount.com',
			private_key: 'secret'
		});
		const creds = parseServiceAccount(Buffer.from(raw).toString('base64'));
		expect(creds?.projectId).toBe('ats-screener');
	});

	it('returns null when unset or blank', () => {
		expect(parseServiceAccount(undefined)).toBeNull();
		expect(parseServiceAccount('')).toBeNull();
		expect(parseServiceAccount('   ')).toBeNull();
	});

	it('returns null for a malformed payload instead of throwing', () => {
		expect(parseServiceAccount('not-json')).toBeNull();
		expect(parseServiceAccount(Buffer.from('not-json').toString('base64'))).toBeNull();
	});

	it('returns null when the payload is missing required fields', () => {
		expect(parseServiceAccount(JSON.stringify({ project_id: 'only-id' }))).toBeNull();
		expect(
			parseServiceAccount(JSON.stringify({ project_id: 'id', client_email: 'no key' }))
		).toBeNull();
	});

	it('ignores unrelated fields on the payload', () => {
		const creds = parseServiceAccount(
			JSON.stringify({
				type: 'service_account',
				project_id: 'ats-screener',
				client_email: 'admin@ats-screener.iam.gserviceaccount.com',
				private_key: 'secret',
				token_uri: 'https://oauth2.googleapis.com/token'
			})
		);
		expect(creds?.projectId).toBe('ats-screener');
	});
});
