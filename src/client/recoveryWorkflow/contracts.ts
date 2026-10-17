import type { FunctionReference } from "convex/server";
import type { RecoveryScope } from "../costRecovery.js";
import type { ResolvedSettlement } from "../settlement/execution.js";
export type RecoveryOperationRef = RecoveryScope & {
  groupKey: string;
  operationId: string;
  version: number;
};
export type RecoveryOperationStatus = RecoveryOperationRef & {
  sourceKind: "settlement" | "invoice";
  sourceId: string;
  status:
    "queued" | "running" | "waiting" | "unknown" | "completed" | "canceled";
  cancelRequested: boolean;
  outcome?: "collect" | "release";
};
export type RecoveryProviderRequest = RecoveryOperationRef & {
  phase: "execute" | "reconcile";
  providerApiVersion: string;
  definitionVersion: number;
};
export type RecoveryProviderReceipt = RecoveryProviderRequest & {
  sourceId: string;
} & (
    | { status: "ready"; outcome: "collect" | "release" }
    | { status: "not_ready"; reason: "provider_pending" }
    | { status: "unknown"; reason: "provider_outcome_unknown" }
  );
export type RecoveryStartOptions = RecoveryScope & {
  groupKey: string;
  requestKey: string;
  provider: FunctionReference<
    "action",
    "internal",
    RecoveryProviderRequest,
    RecoveryProviderReceipt
  >;
  completion?: FunctionReference<
    "mutation",
    "internal",
    RecoveryOperationStatus,
    unknown
  >;
  providerApiVersion: string;
  definitionVersion: 1;
  releaseUncollectible: boolean;
  allocation?: ResolvedSettlement;
  maxAttempts?: number;
  retryDelayMs?: number;
};
export type RecoveryStartResult =
  | RecoveryOperationStatus
  | { status: "conflict"; reason: "identity_changed"; retryable: false }
  | { status: "not_ready"; reason: "history_incomplete"; retryable: true };
export type RecoverySnapshot = RecoveryOperationStatus & {
  providerStarted: boolean;
  activePhase?: "execute" | "reconcile";
  providerApiVersion: string;
  definitionVersion: number;
  allocation?: ResolvedSettlement;
  releaseUncollectible: boolean;
};
export function operationRef(op: RecoveryOperationRef): RecoveryOperationRef {
  return {
    accountId: op.accountId,
    scopeKey: op.scopeKey,
    currency: op.currency,
    groupKey: op.groupKey,
    operationId: op.operationId,
    version: op.version,
  };
}
