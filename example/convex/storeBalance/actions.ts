import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { ownedBillingSubscription } from "./ownership";

export const setFunding = action({
  args: {
    sellerId: v.id("users"),
    enabled: v.boolean(),
    consent: v.optional(v.literal(true)),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.enabled && args.consent !== true)
      throw new Error(
        "Authorize recurring balance payments before confirming.",
      );
    const { seller, sub } = await ownedBillingSubscription(ctx, args.sellerId);
    const legacy = await ctx.runQuery(
      internal.storeBalance.funding.internal.queries.read,
      { sellerId: args.sellerId },
    );
    if (legacy) {
      if (legacy.componentMigration?.state === "rolled_back")
        throw new Error("Compatibility rollback is active.");
      if (
        legacy.subscriptionId !== sub.id ||
        (legacy.componentMigration &&
          legacy.componentMigration.accountId !== seller.stripeAccountId)
      )
        throw new Error(
          "Historical funding identity changed; reconcile before switching writers.",
        );
      if (legacy.componentMigration?.state !== "active") {
        const migrated = await ctx.runAction(
          internal.storeBalance.funding.internal.migrateActions.migrateSeller,
          { sellerId: args.sellerId },
        );
        if (migrated.status !== "active")
          throw new Error(
            "Legacy funding needs receipt reconciliation before new changes.",
          );
      }
    }
    await ctx.runMutation(
      internal.storeBalance.workflow.internal.requests.queue,
      {
        sellerId: args.sellerId,
        accountId: seller.stripeAccountId!,
        subscriptionId: sub.id,
        enabled: args.enabled,
        ...(args.consent ? { consent: args.consent } : {}),
      },
    );
    return null;
  },
});
