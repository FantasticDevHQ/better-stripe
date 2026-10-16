import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { readPayoutOperation } from "./payoutPolicyState.js";
import { collectAdoptionProof } from "./payoutActivationProof.js";
/** A competing identical caller may consume and remove the shared proof cache. */
export async function collectResumableAdoptionProof(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  scope: { accountId: string; ownerKey: string; operationKey: string },
  expectedRevision: number,
  currencies: string[],
  phase: "prepare" | "apply",
) {
  const changed = async () => {
    const operation = await readPayoutOperation(component, ctx, scope);
    return (
      !!operation &&
      (phase === "prepare" ||
        operation.attempted ||
        operation.status === "complete" ||
        operation.status === "canceled")
    );
  };
  try {
    const result = await collectAdoptionProof(
      stripe,
      component,
      ctx,
      scope,
      expectedRevision,
      currencies,
    );
    if (result.status === "held" && (await changed()))
      return { status: "operation_changed" as const };
    return result;
  } catch (error) {
    if (await changed()) return { status: "operation_changed" as const };
    throw error;
  }
}
