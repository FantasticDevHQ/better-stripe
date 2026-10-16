import { api } from "../../../convex/_generated/api";

/**
 * The only page-facing references for the admin Testing page's real Stripe
 * trigger actions. Keep this binding generated-API backed so the type guard in
 * `adminTestingApiShape.ts` can catch stale hand-maintained shims.
 */
export const adminTestingActions = {
  fireAccountUpdated: api.adminTesting.actions.fireAccountUpdated,
  fireSubscriptionUpdated: api.adminTesting.actions.fireSubscriptionUpdated,
  fireCheckoutCompleted: api.adminTesting.actions.fireCheckoutCompleted,
  fireInvoicePaid: api.adminTesting.actions.fireInvoicePaid,
} as const;
