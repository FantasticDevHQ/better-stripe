import { api } from "../../../convex/_generated/api";

/**
 * The only page-facing references for the admin Testing page's real Stripe
 * trigger actions. Keep this binding generated-API backed so the type guard in
 * `adminTestingApiShape.ts` can catch stale hand-maintained shims.
 */
export const adminTestingActions = {
  fireAccountUpdated: api.adminTesting.fireAccountUpdated,
  fireSubscriptionUpdated: api.adminTesting.fireSubscriptionUpdated,
  fireCheckoutCompleted: api.adminTesting.fireCheckoutCompleted,
  fireInvoicePaid: api.adminTesting.fireInvoicePaid,
} as const;
