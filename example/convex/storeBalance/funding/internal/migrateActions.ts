import { v } from "convex/values";
import {
  getPaymentMethodOwner,
  STRIPE_CUSTOMER_PREVIEW_API_VERSION,
} from "@fantastic.dev/better-stripe";
import { internalAction } from "../../../_generated/server";
import { components, internal } from "../../../_generated/api";
import { balanceStripe } from "../../stripe";
import { ownedBillingSubscription } from "../../ownership";
import { LEGACY_FUNDING_API_VERSION } from "../migration";
const result = v.union(
  v.object({ status: v.literal("missing") }),
  v.object({
    status: v.union(v.literal("active"), v.literal("held")),
    fundingId: v.id("storeBalanceFunding"),
  }),
);
export const migrateSeller = internalAction({
  args: { sellerId: v.id("users") },
  returns: result,
  handler: async (ctx, args): Promise<typeof result.type> => {
    if (LEGACY_FUNDING_API_VERSION !== STRIPE_CUSTOMER_PREVIEW_API_VERSION)
      throw new Error("Legacy funding API compatibility requires review.");
    const paused = await ctx.runMutation(
      internal.storeBalance.funding.internal.migration.pause,
      args,
    );
    if (!paused) return { status: "missing" };
    const row = await ctx.runQuery(
      internal.storeBalance.funding.internal.queries.read,
      args,
    );
    if (!row) throw new Error("Legacy funding row changed.");
    if (row.componentMigration?.state === "rolled_back")
      throw new Error(
        "Compatibility rollback is active; verify reverse mapping before another cutover.",
      );
    const { seller, sub } = await ownedBillingSubscription(ctx, args.sellerId);
    if (row.subscriptionId !== sub.id)
      throw new Error("Historical subscription identity changed.");
    const accountId = seller.stripeAccountId!;
    if (row.componentMigration?.state === "active") {
      const link = row.componentMigration;
      if (link.accountId !== accountId)
        throw new Error("Historical account identity changed.");
      const saved = await ctx.runQuery(
        components.betterStripe.balanceFunding.queries.readPreparation,
        {
          accountId,
          scopeKey: link.scopeKey,
          preparationId: link.preparationId,
          stripeSubscriptionId: sub.id,
        },
      );
      return {
        status:
          saved?.verified && !saved.activeOperationId && !saved.startsPaused
            ? "active"
            : "held",
        fundingId: row._id,
      };
    }
    const method = await balanceStripe.getPaymentMethod(ctx, {
      paymentMethodId: row.paymentMethodId,
    });
    if (
      method.id !== row.paymentMethodId ||
      method.type !== "stripe_balance" ||
      getPaymentMethodOwner(method) !== accountId
    )
      throw new Error(
        "Original balance payment method ownership is unavailable.",
      );
    if (row.previousPaymentMethodId) {
      const original = await balanceStripe.getPaymentMethod(ctx, {
        paymentMethodId: row.previousPaymentMethodId,
      });
      if (
        original.id !== row.previousPaymentMethodId ||
        getPaymentMethodOwner(original) !== accountId ||
        original.type === "stripe_balance"
      )
        throw new Error("Original restoration ownership is unavailable.");
    }
    const link = await ctx.runMutation(
      internal.storeBalance.funding.internal.migration.importRecord,
      {
        fundingId: row._id,
        accountId,
        subscriptionId: sub.id,
        snapshot: paused.snapshot,
      },
    );
    const currentMethod =
      typeof sub.default_payment_method === "string"
        ? sub.default_payment_method
        : (sub.default_payment_method?.id ?? null);
    const currentTypes = sub.payment_settings?.payment_method_types ?? null;
    const enabled = row.operationPending ? row.targetEnabled! : row.enabled;
    const expectedMethod = enabled
      ? row.paymentMethodId
      : (row.previousPaymentMethodId ?? null);
    const expectedTypes = enabled
      ? ["stripe_balance"]
      : (row.previousPaymentMethodTypes ?? null);
    const matches =
      currentMethod === expectedMethod &&
      JSON.stringify(
        currentTypes === null ? null : [...currentTypes].sort(),
      ) ===
        JSON.stringify(
          expectedTypes === null ? null : [...expectedTypes].sort(),
        );
    if (!matches) return { status: "held", fundingId: row._id };
    if (link.operation) {
      // Imported UNKNOWN has no journal. Only verified read receipts may finish it.
      await ctx.runMutation(
        components.betterStripe.balanceFunding.mutations.finish,
        {
          ...link.operation,
          enabled,
          receipt: {
            customerAccount: accountId,
            stripeSubscriptionId: sub.id,
            paymentMethodId: currentMethod,
            paymentMethodTypes: currentTypes,
            providerApiVersion: LEGACY_FUNDING_API_VERSION,
          },
        },
      );
    }
    await ctx.runMutation(
      internal.storeBalance.funding.internal.migration.activate,
      { fundingId: row._id },
    );
    return { status: "active", fundingId: row._id };
  },
});
