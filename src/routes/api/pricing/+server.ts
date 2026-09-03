// public pricing info for the paywall UI. no auth required - this is the
// same per-review/monthly price everyone sees before signing in. exists so
// the scanner can show the real server-configured price up front instead of
// a client-side constant that silently drifts from PAYSTACK_PRICE_* once the
// deploy overrides the defaults.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import {
	parseCurrency,
	parsePriceForCurrency,
	parseMonthlyPriceForCurrency
} from '$lib/server/paystack';

export const GET: RequestHandler = async () => {
	const currency = parseCurrency(privateEnv);
	const price = parsePriceForCurrency(privateEnv, currency);
	const monthlyPrice = parseMonthlyPriceForCurrency(privateEnv, currency);
	return json({ price, monthlyPrice, currency });
};
