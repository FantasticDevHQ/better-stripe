import { z } from "zod";
import type { FunctionReference } from "convex/server";
import type {
  FinancialOutcome,
  FinancialUnavailable,
} from "../financialOutcomes/contracts.js";
import { financialUnavailableSchema } from "../financialOutcomes/contracts.js";
import type { RecoveryClaim, RecoveryScope } from "../costRecovery.js";
import type {
  ProcessingCostDeficit,
  ProcessingCostDeficitOptions,
} from "../processingCostDeficit/index.js";
const id = z.string().min(1).max(200);
const units = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const costObservationSchema = z
  .object({
    paymentIntentId: id,
    sourceChargeId: id,
    currency: z.string().regex(/^[a-z]{3}$/),
    gross: units.min(1),
    originalProcessingFee: units,
    processingFee: units,
    disputeFees: units,
    principalReturned: units,
    provenance: z
      .object({
        invoiceId: id,
        invoicePaymentId: id,
        customerAccountId: id,
        subscriptionId: id.optional(),
        stripePriceId: id.optional(),
        stripeProductId: id.optional(),
        recoveryInvoiceItemId: id.optional(),
      })
      .strict(),
  })
  .strict()
  .refine((o) => o.principalReturned <= o.gross);
export type ProcessingCostObservation = z.infer<typeof costObservationSchema>;
export type ProcessingCostSource =
  | {
      kind: "sale";
      paymentIntentId: string;
      gross: number;
      customerAccountId: string;
      invoiceId?: string;
      subscriptionId?: string;
      stripeAccountId?: string;
      stripePriceId?: string;
      stripeProductId?: string;
    }
  | {
      kind: "invoice_recovery";
      paymentIntentId: string;
      gross: number;
      groupKey: string;
    };
export type ProcessingCostPolicy = Pick<
  ProcessingCostDeficitOptions,
  "sellingFee" | "liability" | "rounding"
>;
export type ProcessingCostOperationRef = RecoveryScope & {
  operationId: string;
  version: number;
};
export type ProcessingCostReconciliationResult = {
  claim: RecoveryClaim;
  rollbackClaim?: RecoveryClaim;
  deficit: ProcessingCostDeficit;
  observation: ProcessingCostObservation;
};
export type ProcessingCostCompleted = ProcessingCostOperationRef & {
  status: "completed";
  result: ProcessingCostReconciliationResult;
};
export type ProcessingCostOperationStatus = ProcessingCostOperationRef &
  (
    | { status: "queued" | "running" }
    | { status: "completed"; result: ProcessingCostReconciliationResult }
    | FinancialUnavailable
  );
export type ProcessingCostProviderRequest = ProcessingCostOperationRef & {
  providerApiVersion: string;
  definitionVersion: number;
};
export type ProcessingCostProviderReceipt = ProcessingCostProviderRequest & {
  outcome: FinancialOutcome<ProcessingCostObservation>;
};
export type ProcessingCostImportRequest = ProcessingCostOperationRef & {
  claimKey: string;
  expectedRevision: number;
  sourceChargeId: string;
  sourceGross: number;
  sourceProcessingFee: number;
};
export type ProcessingCostOpeningSnapshot = {
  operationKey: string;
  amountDue: number;
  collectedAmount: number;
  revision: number;
};
export type ProcessingCostStartOptions = RecoveryScope & {
  claimKey: string;
  requestKey: string;
  expectedRevision: number;
  source: ProcessingCostSource;
  policy: ProcessingCostPolicy;
  rollback?: { groupKey: string; expectedRevision: number };
  provider: FunctionReference<
    "action",
    "internal",
    ProcessingCostProviderRequest,
    ProcessingCostProviderReceipt
  >;
  projection?: FunctionReference<
    "mutation",
    "internal",
    ProcessingCostCompleted,
    unknown
  >;
  importHook?: FunctionReference<
    "mutation",
    "internal",
    ProcessingCostImportRequest,
    ProcessingCostOpeningSnapshot | null
  >;
  providerApiVersion: string;
  definitionVersion: 1;
  maxAttempts?: number;
  retryDelayMs?: number;
};
export type ProcessingCostStartResult =
  ProcessingCostOperationStatus | FinancialUnavailable;
export type ProcessingCostSnapshot = Pick<
  ProcessingCostStartOptions,
  | "accountId"
  | "scopeKey"
  | "currency"
  | "source"
  | "policy"
  | "rollback"
  | "providerApiVersion"
  | "definitionVersion"
> & {
  version: number;
  status: string;
  result?: ProcessingCostReconciliationResult;
};
export const providerReceiptSchema = z
  .object({
    accountId: id,
    scopeKey: id,
    currency: z.string().regex(/^[a-z]{3}$/),
    operationId: id,
    version: z.number().int().min(1),
    providerApiVersion: id,
    definitionVersion: z.number().int().min(1),
    outcome: z.union([
      z
        .object({ status: z.literal("ready"), value: costObservationSchema })
        .strict(),
      financialUnavailableSchema,
    ]),
  })
  .strict();
export function processingCostRef(
  op: ProcessingCostOperationRef,
): ProcessingCostOperationRef {
  return {
    accountId: op.accountId,
    scopeKey: op.scopeKey,
    currency: op.currency,
    operationId: op.operationId,
    version: op.version,
  };
}
