import { z } from "zod";
import { runMutationOrThrow, type RunCtx, type Component } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
export type RefundCommandNormalizationOptions = { limit: number };
export type RefundCommandNormalizationResult = {
  normalized: number;
  hasMore: boolean;
};
const optionsSchema = z
  .object({ limit: z.number().int().min(1).max(100) })
  .strict();

/** Trusted-host projection maintenance; a drained component backlog is not complete provider history. */
export async function normalizeRefundCommandBindings(
  component: Component,
  ctx: RunCtx,
  opts: RefundCommandNormalizationOptions,
): Promise<RefundCommandNormalizationResult> {
  const args = optionsSchema.parse(opts);
  return runMutationOrThrow(
    ctx,
    componentRef(
      component,
      "refundHistory/mutations/normalizeRefundCommandBindings",
    ),
    args,
  );
}
