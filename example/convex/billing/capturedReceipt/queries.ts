import { v } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import { query } from "../../_generated/server";
import { stripe } from "../../stripe/helpers";
import { historyActor } from "../history/actor";

export type CapturedReceiptContext = {
  actorId: Id<"users">;
  accountId: string;
  sessionId: string;
};

/** Authenticated original selectors only; demo persona selection grants nothing. */
export const context = query({
  args: { stripeSessionId: v.string() },
  returns: v.object({
    actorId: v.id("users"),
    accountId: v.string(),
    sessionId: v.string(),
  }),
  handler: async (ctx, args): Promise<CapturedReceiptContext> => {
    const actor = await historyActor(ctx);
    if (!args.stripeSessionId.trim())
      throw new Error("Authentication required");
    try {
      const session = await stripe.getCheckoutSessionByStripeId(ctx, args);
      if (
        !session ||
        session.stripeSessionId !== args.stripeSessionId ||
        session.userId !== actor._id ||
        session.orgId !== undefined ||
        session.mode !== "payment" ||
        !session.accountId?.trim()
      )
        throw new Error("Authentication required");
      const account = await stripe.getAccountByStripeId(ctx, {
        stripeAccountId: session.accountId,
        requireUnique: true,
      });
      if (
        !account ||
        account.stripeAccountId !== session.accountId ||
        account.userId !== actor._id ||
        account.orgId !== undefined
      )
        throw new Error("Authentication required");
      return {
        actorId: actor._id,
        accountId: account.stripeAccountId,
        sessionId: session.stripeSessionId,
      };
    } catch {
      // Missing, foreign and ambiguous originals share the same denial.
      throw new Error("Authentication required");
    }
  },
});
