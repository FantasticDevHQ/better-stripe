import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { validateIdentity } from "../../component/refundSync/helpers.js";
import type {
  result,
  routingResult,
} from "../../component/refundSync/validators.js";
import {
  refundApiContext,
  refundSnapshot,
  refundChargeMerchant,
  type RefundSyncScope,
} from "./refundSyncValidation.js";

export type RefundSyncOptions = {
  stripeRefundId: string;
  scope: RefundSyncScope;
};
export type RefundSyncResult = Infer<typeof result>;
export type PreparedRefundSync = Awaited<ReturnType<typeof prepareRefundSync>>;

async function markUnknown(
  component: Component,
  ctx: RunCtx,
  observation: {
    stripeRefundId: string;
    apiContext: string;
    generation: number;
  },
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, "refundSync/mutations/markUnknown"),
    observation,
  );
}

/** Internal preparation for a future transactional host callback; no refund write yet. */
export async function prepareRefundSync(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: RefundSyncOptions,
) {
  const identity = {
    stripeRefundId: opts?.stripeRefundId,
    apiContext: refundApiContext(opts?.scope),
  };
  validateIdentity(identity);
  if (!ctx.runMutation || !ctx.runQuery)
    throw new Error(
      "Refund synchronization requires runMutation and runQuery.",
    );
  const generation = (await runMutationOrThrow(
    ctx,
    componentRef(component, "refundSync/mutations/begin"),
    identity,
  )) as number;
  try {
    const request =
      identity.apiContext === "platform"
        ? {}
        : { stripeAccount: identity.apiContext };
    const refund = refundSnapshot(
      await stripe.refunds.retrieve(identity.stripeRefundId, {}, request),
      identity.stripeRefundId,
    );
    const routing = (await ctx.runQuery(
      componentRef(component, "refundSync/queries/routing"),
      {
        stripeRefundId: refund.stripeRefundId,
        stripePaymentIntentId: refund.stripePaymentIntentId,
        stripeChargeId: refund.stripeChargeId,
        currency: refund.currency,
      },
    )) as Infer<typeof routingResult>;
    if (routing.status === "held")
      throw new Error(
        "Original refund merchant proof is ambiguous or contradictory.",
      );
    const accountId =
      routing.merchantAccount ??
      (routing.requiresChargeProof
        ? refundChargeMerchant(
            await stripe.charges.retrieve(refund.stripeChargeId, {}, request),
            refund,
          )
        : undefined);
    return {
      ...identity,
      generation,
      refund: { ...refund, ...(accountId === undefined ? {} : { accountId }) },
    };
  } catch (error) {
    await markUnknown(component, ctx, { ...identity, generation });
    throw error;
  }
}

/** Host-authorized provider read plus generation-qualified, atomic existing refund synchronization. */
export async function syncRefundFromStripe(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: RefundSyncOptions,
): Promise<RefundSyncResult> {
  const observation = await prepareRefundSync(stripe, component, ctx, opts);
  try {
    return (await runMutationOrThrow(
      ctx,
      componentRef(component, "refundSync/mutations/finish"),
      observation,
    )) as RefundSyncResult;
  } catch (error) {
    await markUnknown(component, ctx, {
      stripeRefundId: observation.stripeRefundId,
      apiContext: observation.apiContext,
      generation: observation.generation,
    });
    throw error;
  }
}
