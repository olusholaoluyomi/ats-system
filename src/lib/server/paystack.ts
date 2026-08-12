// Paystack payment integration. pure + env-record based so it unit-tests in
// isolation exactly like buildProviders() / resolveAuthMode() (pass a {} object,
// assert the result). three capabilities:
//   1. initializePaystack  - open a hosted checkout session for a reference
//   2. verifyPaystack      - ask Paystack whether that reference settled
//   3. verifyWebhookSignature - authenticate a Paystack webhook POST
//
// the secret key lives server-side only (PAYSTACK_SECRET_KEY). the hosted
// redirect flow needs no client-side public key: the user pays on Paystack's
// own page and we settle on the /api/payment/webhook + /api/payment/verify
// endpoints, so no public key ever ships to the browser.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const PAYSTACK_API_BASE = 'https://api.paystack.co';

// default price of one review in naira. overridable per deploy via
// PAYSTACK_PRICE_NGN (kobo conversion happens at the call site).
export const DEFAULT_PRICE_NGN = 5000;

export const CURRENCY = 'NGN';

type Env = Record<string, string | undefined>;

function val(env: Env, key: string): string | undefined {
  const v = env[key];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

// returns null when Paystack is not configured (inert signal, mirroring an
// unset OLLAMA_BASE_URL). consumers fail closed (503) rather than guessing.
export function getPaystackSecret(env: Env): string | null {
  return val(env, 'PAYSTACK_SECRET_KEY') ?? null;
}

// price of one review in naira (whole units). malformed/absent values fall
// back to the default so a typo can never silently price a review at ₦0.
export function parsePriceNg(env: Env): number {
  const raw = val(env, 'PAYSTACK_PRICE_NGN');
  if (!raw) return DEFAULT_PRICE_NGN;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PRICE_NGN;
}

// a price of zero is a foot-gun: it would make every review "free" while the
// payment flow still runs. refuse it loudly so the misconfiguration surfaces.
export function validatePriceNg(priceNgn: number): void {
  if (!Number.isFinite(priceNgn) || priceNgn <= 0) {
    throw new Error(`invalid PAYSTACK_PRICE_NGN (${priceNgn}): must be a positive number of naira`);
  }
}

export class PaystackError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'PaystackError';
    this.status = status;
  }
}

async function paystackFetch(
  secret: string,
  path: string,
  init: RequestInit = {}
): Promise<Record<string, unknown>> {
  const response = await fetch(`${PAYSTACK_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${secret}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    }
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new PaystackError(
      `paystack request failed (${response.status}): ${errBody.slice(0, 300)}`,
      response.status
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    status?: unknown;
    message?: unknown;
    data?: unknown;
  };
  if (data.status !== true) {
    throw new PaystackError(
      `paystack returned status !== true: ${String(data.message ?? 'unknown')}`
    );
  }
  return (data.data as Record<string, unknown>) ?? {};
}

export interface InitializeOptions {
  email: string;
  reference: string;
  amountKobo: number;
  callbackUrl: string;
  cancelUrl?: string;
}

export interface InitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

// opens a hosted Paystack checkout for a review. throws PaystackError on any
// failure so callers can map it to a 502 without guessing.
export async function initializePaystack(
  env: Env,
  opts: InitializeOptions
): Promise<InitializeResult> {
  const secret = getPaystackSecret(env);
  if (!secret) throw new PaystackError('PAYSTACK_SECRET_KEY not configured', 503);

  const data = await paystackFetch(secret, '/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: opts.email,
      amount: opts.amountKobo,
      reference: opts.reference,
      currency: CURRENCY,
      callback_url: opts.callbackUrl,
      ...(opts.cancelUrl ? { cancel_url: opts.cancelUrl } : {})
    })
  });

  const authorizationUrl = data.authorization_url;
  if (typeof authorizationUrl !== 'string' || authorizationUrl.length === 0) {
    throw new PaystackError('paystack initialize returned no authorization_url');
  }

  return {
    authorization_url: authorizationUrl,
    access_code: typeof data.access_code === 'string' ? data.access_code : '',
    reference: opts.reference
  };
}

export interface VerifyResult {
  status: string;
  paid: boolean;
  amountKobo: number;
  currency: string;
}

// asks Paystack whether a transaction reference settled. returns null when the
// reference is unknown or Paystack cannot answer (the caller decides how to
// surface that; a null must never be treated as "paid").
export async function verifyPaystack(
  env: Env,
  reference: string
): Promise<VerifyResult | null> {
  const secret = getPaystackSecret(env);
  if (!secret) return null;

  try {
    const data = await paystackFetch(
      secret,
      `/transaction/verify/${encodeURIComponent(reference)}`
    );
    const status = typeof data.status === 'string' ? data.status : '';
    return {
      status,
      paid: status === 'success',
      amountKobo: Number(data.amount) || 0,
      currency: typeof data.currency === 'string' ? data.currency : ''
    };
  } catch {
    // network hiccup / unknown reference / misconfigured key. null means
    // "could not confirm", never "failed the charge".
    return null;
  }
}

// verifies a Paystack webhook signature. Paystack signs the raw request body
// with HMAC-SHA512 using the secret key; the digest is hex. compares with a
// constant-time helper so length mismatches short-circuit safely.
export function verifyWebhookSignature(
  secret: string | null | undefined,
  rawBody: string,
  signature: string | null | undefined
): boolean {
  if (!secret || !rawBody || !signature) return false;
  const expected = createHmac('sha512', secret).update(rawBody, 'utf8').digest('hex');
  const actual = Buffer.from(signature.trim(), 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (actual.length !== expectedBuf.length) return false;
  return timingSafeEqual(actual, expectedBuf);
}
