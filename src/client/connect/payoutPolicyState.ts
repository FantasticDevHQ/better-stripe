import type { Infer } from "convex/values";
import type {
  operationDoc,
  policyDoc,
} from "../../component/payoutPolicy/schema.js";
import type { Component, RunCtx } from "../helpers.js";
import { validateScope } from "../../component/payoutPolicy/helpers.js";
import { componentRef } from "../webhooks/helpers.js";
/** Re-read the same durable operation; callers must still authorize the recipient scope. */
export function readPayoutOperation(
  component: Component,
  ctx: RunCtx,
  args: { accountId: string; ownerKey: string; operationKey: string },
): Promise<Infer<typeof operationDoc> | null> {
  validateScope(args);
  return ctx.runQuery(
    componentRef(component, "payoutPolicy/queries/operation"),
    {
      accountId: args.accountId,
      ownerKey: args.ownerKey,
      operationKey: args.operationKey,
    },
  );
}

export function readPayoutPolicy(
  component: Component,
  ctx: RunCtx,
  scope: { accountId: string; ownerKey: string },
): Promise<Infer<typeof policyDoc> | null> {
  validateScope(scope);
  return ctx.runQuery(componentRef(component, "payoutPolicy/queries/get"), {
    accountId: scope.accountId,
    ownerKey: scope.ownerKey,
  });
}
