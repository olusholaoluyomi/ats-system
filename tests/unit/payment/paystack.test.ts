import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
	DEFAULT_PRICE_NGN,
	getPaystackSecret,
	initializePaystack,
	parsePriceNg,
	verifyPaystack,
	verifyWebhookSignature
} from '../../../src/lib/server/paystack';

// Paystack signs webhooks with HMAC-SHA512 over the raw body using the secret
// key, hex-encoded. the cross-check below pins our verifier to Node's own
// crypto so a refactor can never silently diverge from the spec.
const SECRET = 'sk_test_abc123';

function hmacHex(body: string): string {
	return createHmac('sha512', SECRET).update(body, 'utf8').digest('hex');
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('verifyWebhookSignature', () => {
	const body = '{"event":"charge.success","data":{"reference":"ref_1"}}';

	it('accepts a valid HMAC-SHA512 signature', () => {
		expect(verifyWebhookSignature(SECRET, body, hmacHex(body))).toBe(true);
	});

	it('rejects a tampered body', () => {
		const sig = hmacHex(body);
		expect(verifyWebhookSignature(SECRET, body + 'x', sig)).toBe(false);
	});

	it('rejects a signature produced with a different secret', () => {
		const other = createHmac('sha512', 'sk_test_other').update(body, 'utf8').digest('hex');
		expect(verifyWebhookSignature(SECRET, body, other)).toBe(false);
	});

	it('rejects a missing / malformed signature', () => {
		expect(verifyWebhookSignature(SECRET, body, null)).toBe(false);
		expect(verifyWebhookSignature(SECRET, body, undefined)).toBe(false);
		expect(verifyWebhookSignature(SECRET, body, 'not-hex')).toBe(false);
	});

	it('rejects when the secret or body is empty', () => {
		expect(verifyWebhookSignature(null, body, hmacHex(body))).toBe(false);
		expect(verifyWebhookSignature('', body, hmacHex(body))).toBe(false);
		expect(verifyWebhookSignature(SECRET, '', hmacHex(body))).toBe(false);
	});

	it('accepts a signature with surrounding whitespace (header trimming)', () => {
		expect(verifyWebhookSignature(SECRET, body, `  ${hmacHex(body)}  `)).toBe(true);
	});
});

describe('getPaystackSecret', () => {
	it('returns null when unset', () => {
		expect(getPaystackSecret({})).toBeNull();
		expect(getPaystackSecret({ PAYSTACK_SECRET_KEY: '   ' })).toBeNull();
	});

	it('returns the trimmed secret when set', () => {
		expect(getPaystackSecret({ PAYSTACK_SECRET_KEY: ' sk_live_x ' })).toBe('sk_live_x');
	});
});

describe('parsePriceNg', () => {
	it('defaults to ₦5,000 when unset', () => {
		expect(parsePriceNg({})).toBe(DEFAULT_PRICE_NGN);
		expect(parsePriceNg({ PAYSTACK_PRICE_NGN: '' })).toBe(DEFAULT_PRICE_NGN);
	});

	it('reads the configured price', () => {
		expect(parsePriceNg({ PAYSTACK_PRICE_NGN: '10000' })).toBe(10000);
	});

	it('ignores malformed / non-positive values (never a free review by typo)', () => {
		expect(parsePriceNg({ PAYSTACK_PRICE_NGN: '0' })).toBe(DEFAULT_PRICE_NGN);
		expect(parsePriceNg({ PAYSTACK_PRICE_NGN: '-5' })).toBe(DEFAULT_PRICE_NGN);
		expect(parsePriceNg({ PAYSTACK_PRICE_NGN: 'abc' })).toBe(DEFAULT_PRICE_NGN);
	});
});

describe('initializePaystack', () => {
	function stubFetch(overrides: { ok?: boolean; status?: boolean; data?: unknown } = {}) {
		const { ok = true, status = true, data = {} } = overrides;
		const fetchMock = vi.fn().mockResolvedValue({
			ok,
			status: ok ? 200 : 400,
			text: async () => 'err',
			json: async () => ({ status, message: 'msg', data })
		});
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	it('posts to /transaction/initialize with bearer auth and kobo amount', async () => {
		const fetchMock = stubFetch({
			data: { authorization_url: 'https://checkout.paystack.com/x', access_code: 'ac_1' }
		});
		const env = { PAYSTACK_SECRET_KEY: SECRET };

		const result = await initializePaystack(env, {
			email: 'a@b.com',
			reference: 'ref_1',
			amountKobo: 500000,
			callbackUrl: 'https://site.example/payment/callback',
			cancelUrl: 'https://site.example/scanner'
		});

		expect(result.authorization_url).toBe('https://checkout.paystack.com/x');
		expect(result.reference).toBe('ref_1');

		const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
		expect(url).toBe('https://api.paystack.co/transaction/initialize');
		expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
		const payload = JSON.parse(init.body);
		expect(payload).toMatchObject({
			email: 'a@b.com',
			reference: 'ref_1',
			amount: 500000,
			currency: 'NGN'
		});
	});

	it('throws when the secret is not configured', async () => {
		await expect(
			initializePaystack({}, {
				email: 'a@b.com',
				reference: 'r',
				amountKobo: 500000,
				callbackUrl: 'https://site.example/payment/callback'
			})
		).rejects.toThrow('PAYSTACK_SECRET_KEY not configured');
	});

	it('throws when Paystack returns a non-2xx response', async () => {
		stubFetch({ ok: false });
		await expect(
			initializePaystack({ PAYSTACK_SECRET_KEY: SECRET }, {
				email: 'a@b.com',
				reference: 'r',
				amountKobo: 500000,
				callbackUrl: 'https://site.example/payment/callback'
			})
		).rejects.toThrow('paystack request failed');
	});

	it('throws when the response carries no authorization_url', async () => {
		stubFetch({ status: true, data: {} });
		await expect(
			initializePaystack({ PAYSTACK_SECRET_KEY: SECRET }, {
				email: 'a@b.com',
				reference: 'r',
				amountKobo: 500000,
				callbackUrl: 'https://site.example/payment/callback'
			})
		).rejects.toThrow('no authorization_url');
	});
});

describe('verifyPaystack', () => {
	function stubFetch(data: unknown) {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ status: true, message: 'ok', data })
		});
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	it('reports a successful charge with the kobo amount', async () => {
		const fetchMock = stubFetch({ status: 'success', amount: 500000, currency: 'NGN' });
		const result = await verifyPaystack({ PAYSTACK_SECRET_KEY: SECRET }, 'ref_1');
		expect(result).toEqual({ status: 'success', paid: true, amountKobo: 500000, currency: 'NGN' });
		const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
		expect(url).toBe('https://api.paystack.co/transaction/verify/ref_1');
		expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
	});

	it('reports an unpaid status', async () => {
		stubFetch({ status: 'failed', amount: 0, currency: 'NGN' });
		const result = await verifyPaystack({ PAYSTACK_SECRET_KEY: SECRET }, 'ref_1');
		expect(result?.paid).toBe(false);
		expect(result?.status).toBe('failed');
	});

	it('returns null when Paystack errors (never a false "paid")', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'no' })
		);
		expect(await verifyPaystack({ PAYSTACK_SECRET_KEY: SECRET }, 'ref_1')).toBeNull();
	});

	it('returns null when the secret is missing', async () => {
		expect(await verifyPaystack({}, 'ref_1')).toBeNull();
	});
});
