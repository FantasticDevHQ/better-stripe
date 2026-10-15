import { policiesTable, operationsTable } from "./payoutPolicy/schema.js";
import { currencyTotalsTable } from "./earnings/schema.js";
import {
  claimsTable,
  balancesTable,
  groupsTable,
  reservationsTable,
} from "./costRecovery/schema";
import {
  allocationsTable,
  commissionTermsTable,
  commissionDecisionsTable,
} from "./settlement/schema";
import { defineSchema } from "convex/server";

import {
  checkoutSessionsTable,
  invoicesTable,
  subscriptionsTable,
} from "./billing/schema";
import {
  disputesTable,
  paymentsTable,
  payoutsTable,
  pendingFeeRefundsTable,
  refundsTable,
  transferReversalOpsTable,
  transfersTable,
} from "./connect/schema";
import { accountsTable } from "./core/schema";
import { pricesTable, productsTable } from "./products/schema";
import { webhookEventsTable } from "./webhooks/schema";

export default defineSchema({
  payoutPolicies: policiesTable,
  payoutPolicyOperations: operationsTable,
  currencyTotals: currencyTotalsTable,
  recoveryClaims: claimsTable,
  recoveryBalances: balancesTable,
  recoveryGroups: groupsTable,
  recoveryReservations: reservationsTable,
  settlementAllocations: allocationsTable,
  commissionTerms: commissionTermsTable,
  commissionDecisions: commissionDecisionsTable,
  // Core
  accounts: accountsTable,

  // Products
  products: productsTable,
  prices: pricesTable,

  // Billing
  subscriptions: subscriptionsTable,
  checkoutSessions: checkoutSessionsTable,
  invoices: invoicesTable,

  // Connect
  payments: paymentsTable,
  payouts: payoutsTable,
  pendingFeeRefunds: pendingFeeRefundsTable,
  refunds: refundsTable,
  disputes: disputesTable,
  transfers: transfersTable,
  transferReversalOps: transferReversalOpsTable,

  // Webhooks
  webhookEvents: webhookEventsTable,
});
