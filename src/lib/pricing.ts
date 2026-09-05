export const SCANS_PER_PAYMENT = 4;
export const MONTHLY_SUBSCRIPTION_DAYS = 30;
// gifted to every brand-new account (see billing.ts's DEFAULT_BILLING) -
// deliberately smaller than SCANS_PER_PAYMENT: enough to prove the product's
// value, not so much that it delays converting to a paid plan while the
// business is still pre-revenue and running on Firestore's free tier.
export const FREE_SCANS_ON_SIGNUP = 2;
