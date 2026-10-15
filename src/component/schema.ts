import {
  payoutReleasesTable as affiliatePayoutReleases,
  operationsTable as affiliateOperations,
  earningsTable as affiliateEarnings,
  offsetsTable as affiliateOffsets,
  balancesTable as affiliateBalances,
} from "./affiliateRecovery/schema.js";
import {
  affiliateObligationsTable,
  affiliateReversalReceiptsTable,
} from "./settlement/clawbackSchema.js";
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
  affiliateObligations: affiliateObligationsTable,
  affiliateRecoveryOperations: affiliateOperations,
  affiliatePayoutReleases,
  affiliateEarnings,
  affiliateOffsets,
  affiliateRecoveryBalances: affiliateBalances,
  affiliateReversalReceipts: affiliateReversalReceiptsTable,
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
