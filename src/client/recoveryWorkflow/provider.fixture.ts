import workflowTest from "@convex-dev/workflow/test";
import { componentsGeneric, type FunctionReference } from "convex/server";
import { initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import { CostRecoveryClient } from "../costRecovery.js";
import type { Component, RunCtx } from "../helpers.js";
import type { SettlementPolicyContext } from "../../shared/settlementPolicyContext.js";
import type { RecoveryProviderRequest } from "./contracts.js";
const modules = import.meta.glob("../../component/**/*.ts");
export const nested = componentsGeneric();
export const scope = {
  accountId: "acct_owner",
  scopeKey: "store",
  currency: "usd",
  groupKey: "group",
};
export async function setup(
  kind: "invoice" | "settlement" = "invoice",
  dispatch = true,
  releaseUncollectible = false,
  twoLegs = false,
  policyContext?: SettlementPolicyContext,
) {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  workflowTest.register(t, "betterStripe/workflow");
  const component = nested.betterStripe as unknown as Component;
  const client = new CostRecoveryClient(component);
  let writes = 0,
    failWrite = 0;
  const ctx = {
    runQuery: (
      ref: FunctionReference<"query">,
      args: Record<string, unknown>,
    ) => t.query(ref, args),
    runMutation: (
      ref: FunctionReference<"mutation">,
      args: Record<string, unknown>,
    ) => {
      if (++writes === failWrite) throw new Error("private database detail");
      return t.mutation(ref, args);
    },
  } as unknown as RunCtx;
  await client.recordClaim(ctx, {
    accountId: scope.accountId,
    scopeKey: scope.scopeKey,
    currency: scope.currency,
    claimKey: "claim",
    sourceChargeId: "ch_original",
    sourceGross: 1000,
    sourceProcessingFee: 30,
    amountDue: 30,
    revision: 1,
  });
  const allocation = {
    ...(policyContext ? { policyContext } : {}),
    sourceChargeId: "ch_source",
    gross: 1000,
    currency: "usd",
    processingFee: 30,
    platformNet: 40,
    adjustmentAmount: 30,
    transfers: twoLegs
      ? [
          {
            destinationAccountId: "acct_seller",
            role: "store" as const,
            amount: 800,
          },
          {
            destinationAccountId: "acct_other",
            role: "other" as const,
            amount: 100,
          },
        ]
      : [
          {
            destinationAccountId: "acct_seller",
            role: "store" as const,
            amount: 900,
          },
        ],
  };
  await client.prepareGroup(ctx, {
    ...scope,
    ...(kind === "settlement"
      ? {
          sourceKind: "settlement" as const,
          sourceId: "ch_source",
          sourceGross: 1000,
          sourceProcessingFee: 30,
        }
      : { sourceKind: "invoice" as const, sourceId: "in_source" }),
    maxDebit: 1000,
    maxCredit: 0,
  });
  const op = await t.mutation(
    nested.betterStripe.recoveryWorkflow.mutations.start,
    {
      ...scope,
      requestKey: "request",
      provider: "function://fixture/provider",
      providerApiVersion: "2026-09-30.endive",
      definitionVersion: 1,
      releaseUncollectible,
      maxAttempts: 2,
      retryDelayMs: 1,
      ...(kind === "settlement" ? { allocation } : {}),
    },
  );
  const request: RecoveryProviderRequest = {
    ...scope,
    operationId: op.operationId,
    version: op.version,
    phase: "execute",
    providerApiVersion: "2026-09-30.endive",
    definitionVersion: 1,
  };
  if (dispatch)
    await t.mutation(nested.betterStripe.recoveryWorkflow.steps.beginProvider, {
      ...scope,
      operationId: op.operationId,
      version: 1,
      phase: "execute",
    });
  return {
    dispatchReconcile: () =>
      t.mutation(nested.betterStripe.recoveryWorkflow.steps.beginProvider, {
        ...scope,
        operationId: op.operationId,
        version: 1,
        phase: "reconcile",
      }),
    t,
    client,
    ctx,
    request,
    group: (await client.getGroup(ctx, { groupKey: scope.groupKey }))!,
    failNext: (offset = 1) => {
      failWrite = writes + offset;
    },
  };
}
