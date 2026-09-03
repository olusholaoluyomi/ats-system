import { describe, expect, it, beforeEach } from 'vitest';

// $env/dynamic/private is globally mocked to {} in tests/setup.ts; each test
// below reassigns its properties to drive parseCurrency/parsePriceForCurrency.
import { env as privateEnv } from '$env/dynamic/private';

describe('GET /api/pricing', () => {
	beforeEach(() => {
		for (const key of Object.keys(privateEnv)) delete (privateEnv as Record<string, unknown>)[key];
	});

	it('returns the NGN defaults when nothing is configured', async () => {
		const { GET } = await import('../../../src/routes/api/pricing/+server');
		const res = await GET({} as never);
		const body = await res.json();
		expect(body).toEqual({ price: 10000, monthlyPrice: 50000, currency: 'NGN' });
	});

	it('reflects a custom configured price and currency', async () => {
		Object.assign(privateEnv, {
			PAYSTACK_CURRENCY: 'USD',
			PAYSTACK_PRICE_USD: '5',
			PAYSTACK_PRICE_MONTHLY_USD: '20'
		});
		const { GET } = await import('../../../src/routes/api/pricing/+server');
		const res = await GET({} as never);
		const body = await res.json();
		expect(body).toEqual({ price: 5, monthlyPrice: 20, currency: 'USD' });
	});
});
