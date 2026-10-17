import {
  preparationsTable as balanceFundingPreparations,
  operationsTable as balanceFundingOperations,
  requestsTable as balanceFundingRequests,
} from "./balanceFunding/schema.js";
import {
  payloadsTable as operationEvidencePayloads,
  headersTable as operationEvidenceHeaders,
} from "./operationEvidence/schema.js";
import { transferBatchReferencesTable } from "./financialObservations/transferReferenceSchema.js";
import {
  transferObservationsTable,
  transferBatchesTable,
} from "./financialObservations/transferSchema.js";
import {
  sourceObservationsTable,
  sourceLegsTable,
  observationGenerationsTable,
} from "./financialObservations/schema.js";
import {
  ownershipTable,
  generationsTable,
} from "./financialOwnership/schema.js";
import { accountClosuresTable } from "./accountClosure/schema.js";
import { jobsTable as payoutWorkerJobsTable } from "./payoutWorker/schema.js";
import {
  financialRevisionsTable,
  riskEventsTable,
  riskRevisionsTable,
  snapshotsTable,
  snapshotSourcesTable,
  snapshotClaimsTable,
  snapshotFeesTable,
} from "./payoutSnapshots/schema.js";
import { claimsTable as payoutSyncClaimsTable } from "./payoutSync/schema.js";
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
  feeBalancesTable as payoutFeeBalancesTable,
  claimsTable as payoutReleaseClaimsTable,
  sourcesTable as payoutSourceAllocationsTable,
} from "./payoutRelease/schema.js";
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
  balanceFundingPreparations,
  balanceFundingOperations,
  balanceFundingRequests,
  operationEvidencePayloads,
  operationEvidenceHeaders,
  financialTransferObservations: transferObservationsTable,
  financialTransferBatches: transferBatchesTable,
  financialTransferBatchReferences: transferBatchReferencesTable,
  financialSourceObservations: sourceObservationsTable,
  financialSourceLegs: sourceLegsTable,
  financialObservationGenerations: observationGenerationsTable,
  financialOwnership: ownershipTable,
  financialOwnershipGenerations: generationsTable,
  payoutWorkerJobs: payoutWorkerJobsTable,
  payoutFinancialRevisions: financialRevisionsTable,
  payoutRiskEvents: riskEventsTable,
  payoutRiskRevisions: riskRevisionsTable,
  payoutSnapshots: snapshotsTable,
  payoutSnapshotSources: snapshotSourcesTable,
  payoutSnapshotClaims: snapshotClaimsTable,
  payoutSnapshotFees: snapshotFeesTable,
  affiliateObligations: affiliateObligationsTable,
  affiliateRecoveryOperations: affiliateOperations,
  affiliatePayoutReleases,
  affiliateEarnings,
  affiliateOffsets,
  affiliateRecoveryBalances: affiliateBalances,
  affiliateReversalReceipts: affiliateReversalReceiptsTable,
  payoutSyncClaims: payoutSyncClaimsTable,
  payoutFeeBalances: payoutFeeBalancesTable,
  payoutReleaseClaims: payoutReleaseClaimsTable,
  payoutSourceAllocations: payoutSourceAllocationsTable,
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
  accountClosures: accountClosuresTable,

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
