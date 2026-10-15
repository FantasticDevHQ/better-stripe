import type Stripe from "stripe";
import type { Infer } from "convex/values";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { validateScope } from "../../component/payoutPolicy/helpers.js";
import type { previewResult } from "../../component/payoutRelease/preview.js";
import {
  collectPayoutQualification,
  type PayoutControlVerification,
} from "./payoutQualification.js";
export type PayoutPreviewOptions = {
  accountId: string;
  ownerKey: string;
  currency: string;
  independentLiabilities: number;
  maxPages?: number;
};
export type PayoutPreview =
  Infer<typeof previewResult> | { status: "held"; reason: string; amount: 0 };
/** Informational assessment only. Release always repeats qualification and atomically reserves funds. */
export async function previewRecipientPayout(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: PayoutPreviewOptions,
  verify: PayoutControlVerification,
): Promise<PayoutPreview> {
  validateScope(opts);
  const maxPages = opts.maxPages ?? 10;
  if (
    !/^[a-z]{3}$/.test(opts.currency) ||
    !Number.isSafeInteger(opts.independentLiabilities) ||
    opts.independentLiabilities < 0 ||
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100
  )
    throw new Error("Invalid payout preview scope or budget.");
  const held = (reason: string) => ({
    status: "held" as const,
    reason,
    amount: 0 as const,
  });
  const controls = await verify();
  if (controls.status !== "verified" || !("policy" in controls))
    return held(controls.status);
  const proof = await collectPayoutQualification(
    stripe,
    component,
    ctx,
    opts,
    maxPages,
  );
  if (proof.status !== "verified") return held(proof.reason);
  const latest = await verify();
  if (latest.status !== "verified" || !("policy" in latest))
    return held(latest.status);
  if (latest.policy.revision !== controls.policy.revision)
    return held("policy_changed");
  if (
    proof.observedAt < Date.now() - 30000 ||
    proof.observations.some((o) => o.observedAt < Date.now() - 30000)
  )
    return held("observations_stale");
  return ctx.runQuery(
    componentRef(component, "payoutRelease/queries/preview"),
    {
      accountId: opts.accountId,
      ownerKey: opts.ownerKey,
      currency: opts.currency,
      expectedRevision: controls.policy.revision,
      observations: proof.observations,
      providerAvailable: proof.providerAvailable,
      independentLiabilities: opts.independentLiabilities,
    },
  );
}
