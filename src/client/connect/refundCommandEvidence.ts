import type { Infer } from "convex/values";
import { z } from "zod";
import { assertRefundCommandScope } from "../../shared/refundCommandScope.js";
import type { refundCommandEvidenceValidator } from "../../component/refundHistory/commandEvidenceValidator.js";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";

export type RefundCommandEvidence = Infer<
  typeof refundCommandEvidenceValidator
>;
export type RefundCommandEvidenceOptions = {
  commandKey: string;
  stripeAccountId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  currency: string;
};
const optionsSchema = z
  .object({
    commandKey: z.string(),
    stripeAccountId: z.string(),
    stripePaymentIntentId: z.string(),
    stripeChargeId: z.string(),
    currency: z.string(),
  })
  .strict();

/** Host authorization and original command qualification are required before this observation. */
export async function getRefundCommandEvidence(
  component: Component,
  ctx: RunCtx,
  input: RefundCommandEvidenceOptions,
): Promise<RefundCommandEvidence> {
  const { stripeAccountId, ...options } = optionsSchema.parse(input);
  const scope = { ...options, accountId: stripeAccountId };
  assertRefundCommandScope(scope);
  return ctx.runQuery(
    componentRef(component, "refundHistory/queries/getRefundCommandEvidence"),
    scope,
  );
}
