// client-side currency symbol lookup, mirroring the currencies Paystack
// supports (see SUPPORTED_CURRENCIES in $lib/server/paystack, which can't be
// imported here since it pulls in node:crypto).
const CURRENCY_SYMBOLS: Record<string, string> = {
	NGN: '₦',
	USD: '$',
	GHS: 'GH₵',
	KES: 'KSh',
	ZAR: 'R'
};

export function currencySymbol(currency: string): string {
	return CURRENCY_SYMBOLS[currency] ?? currency;
}
