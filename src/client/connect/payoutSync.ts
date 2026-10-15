import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { validateIdentity } from "../../component/payoutSync/helpers.js";
import type { result } from "../../component/payoutSync/validators.js";
import {
  payoutAccount,
  payoutSnapshot,
  type PayoutSyncScope,
} from "./payoutSyncValidation.js";
export type PayoutSyncOptions = {
  stripePayoutId: string;
  scope: PayoutSyncScope;
};
export type PayoutSyncResult = Infer<typeof result>;
export type PreparedPayoutSync = Awaited<ReturnType<typeof preparePayoutSync>>;
async function markUnknown(
  component: Component,
  ctx: RunCtx,
  observation: {
    stripePayoutId: string;
    accountId: string;
    generation: number;
  },
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, "payoutSync/mutations/markUnknown"),
    observation,
  );
}
/** Package-internal preparation for transactional host webhook dispatch. No financial record write. */
export async function preparePayoutSync(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: PayoutSyncOptions,
) {
  const identity = {
    stripePayoutId: opts.stripePayoutId,
    accountId: payoutAccount(opts.scope),
  };
  validateIdentity(identity);
  if (!ctx.runMutation)
    throw new Error("Payout synchronization requires runMutation.");
  const generation = (await runMutationOrThrow(
    ctx,
    componentRef(component, "payoutSync/mutations/begin"),
    identity,
  )) as number;
  try {
    const payout = await stripe.payouts.retrieve(
      identity.stripePayoutId,
      {},
      identity.accountId === "platform"
        ? {}
        : { stripeAccount: identity.accountId },
    );
    return {
      ...identity,
      generation,
      payout: payoutSnapshot(payout, identity),
    };
  } catch (error) {
    await markUnknown(component, ctx, { ...identity, generation });
    throw error;
  }
}
/** Host must authorize scope. This only reads Stripe and synchronizes the existing financial record. */
export async function syncPayoutFromStripe(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: PayoutSyncOptions,
): Promise<PayoutSyncResult> {
  const observation = await preparePayoutSync(stripe, component, ctx, opts);
  try {
    return (await runMutationOrThrow(
      ctx,
      componentRef(component, "payoutSync/mutations/finish"),
      observation,
    )) as PayoutSyncResult;
  } catch (error) {
    await markUnknown(component, ctx, {
      stripePayoutId: observation.stripePayoutId,
      accountId: observation.accountId,
      generation: observation.generation,
    });
    throw error;
  }
}
