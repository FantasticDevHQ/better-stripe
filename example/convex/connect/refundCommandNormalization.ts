import type { RefundCommandNormalizationResult } from "@fantastic.dev/better-stripe";
import type { ActionCtx } from "../_generated/server.js";
import { stripe } from "../stripe/helpers.js";

/** Internal maintenance reference only: authenticate a platform operator before calling; never expose to demo personas. */
export async function normalizeLegacyRefundCommandBindings(
  ctx: ActionCtx,
  limit: number,
): Promise<RefundCommandNormalizationResult> {
  return stripe.normalizeRefundCommandBindings(ctx, { limit });
}
