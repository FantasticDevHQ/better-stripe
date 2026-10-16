/** Real Stripe sandbox renewal scenarios. Invoked by scripts/test-balance-renewals.ts. */
import { v } from "convex/values";

import { type ActionCtx } from "../../_generated/server";

import { internal } from "../../_generated/api";

import type { Id } from "../../_generated/dataModel";

export async function clockId(
  ctx: ActionCtx,
  sellerId: Id<"users">,
): Promise<string> {
  const id = await ctx.runQuery(
    internal.sandboxFixtures.state.internal.queries.resource,
    {
      key: `renewal:${sellerId}:clock`,
    },
  );
  if (!id) throw new Error("Test clock is missing.");
  return id;
}

export const snapshotValidator = v.object({
  clockStatus: v.string(),
  clockTime: v.number(),
  available: v.number(),
  subscriptionStatus: v.string(),
  periodEnd: v.number(),
  hasAccess: v.boolean(),
  localStatus: v.string(),
  costs: v.array(
    v.object({
      paymentIntentId: v.string(),
      amountDue: v.number(),
      outstanding: v.number(),
      collected: v.number(),
      invoiced: v.number(),
      reserved: v.number(),
      sourceType: v.string(),
    }),
  ),
  invoice: v.object({
    id: v.string(),
    status: v.string(),
    total: v.number(),
    amountPaid: v.number(),
    amountRemaining: v.number(),
    reason: v.string(),
    lines: v.array(v.object({ description: v.string(), amount: v.number() })),
  }),
  payment: v.object({
    id: v.string(),
    status: v.string(),
    method: v.string(),
    declineCode: v.string(),
    errorCode: v.string(),
    errorMessage: v.string(),
  }),
  debits: v.array(
    v.object({
      id: v.string(),
      amount: v.number(),
      fee: v.number(),
      net: v.number(),
      description: v.string(),
    }),
  ),
});
