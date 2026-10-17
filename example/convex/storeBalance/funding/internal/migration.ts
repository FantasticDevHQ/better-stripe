import { v } from "convex/values";
import { components } from "../../../_generated/api";
import { internalMutation } from "../../../_generated/server";
import { migrationLink } from "../helpers";
import {
  fundingScope,
  legacySnapshot,
  LEGACY_FUNDING_API_VERSION,
} from "../migration";

export const pause = internalMutation({
  args: { sellerId: v.id("users") },
  returns: v.union(
    v.object({ fundingId: v.id("storeBalanceFunding"), snapshot: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .take(2);
    if (rows.length > 1)
      throw new Error("Ambiguous legacy balance funding rows.");
    const row = rows[0];
    if (!row) return null;
    await ctx.db.patch("storeBalanceFunding", row._id, {
      migrationPaused: true,
    });
    return { fundingId: row._id, snapshot: await legacySnapshot(row) };
  },
});

/** Trusted host mutation: call only after verifying the original subscription at Stripe. */
export const importRecord = internalMutation({
  args: {
    fundingId: v.id("storeBalanceFunding"),
    accountId: v.string(),
    subscriptionId: v.string(),
    snapshot: v.string(),
  },
  returns: migrationLink,
  handler: async (ctx, args) => {
    const row = await ctx.db.get("storeBalanceFunding", args.fundingId);
    if (!row?.migrationPaused || (await legacySnapshot(row)) !== args.snapshot)
      throw new Error(
        "Legacy funding snapshot changed or starts are not paused.",
      );
    const seller = await ctx.db.get("users", row.sellerId);
    if (
      seller?.role !== "seller" ||
      seller.stripeAccountId !== args.accountId ||
      seller.storePlan?.stripeSubscriptionId !== row.subscriptionId ||
      args.subscriptionId !== row.subscriptionId
    )
      throw new Error("Legacy funding account/subscription identity changed.");
    const version = row.operationVersion ?? 0;
    if (
      !Number.isSafeInteger(version) ||
      version < 0 ||
      (row.operationPending &&
        (version < 1 || typeof row.targetEnabled !== "boolean"))
    )
      throw new Error(
        "Original legacy operation version or target is missing.",
      );
    const sourceKey = `example:storeBalanceFunding:${row._id}`;
    const scopeKey = fundingScope(row.sellerId, row.subscriptionId);
    if (
      row.componentMigration &&
      (row.componentMigration.snapshot !== args.snapshot ||
        row.componentMigration.accountId !== args.accountId ||
        row.componentMigration.scopeKey !== scopeKey)
    )
      throw new Error("Legacy funding checkpoint identity changed.");
    const imported = await ctx.runMutation(
      components.betterStripe.balanceFunding.mutations.importPreparation,
      {
        accountId: args.accountId,
        scopeKey,
        sourceKey,
        preparation: {
          customerAccount: args.accountId,
          stripeSubscriptionId: row.subscriptionId,
          paymentMethodId: row.paymentMethodId,
          previousPaymentMethodId: row.previousPaymentMethodId ?? null,
          previousPaymentMethodTypes: row.previousPaymentMethodTypes ?? null,
        },
        consentAt: row.consentAt,
        consentReference: `legacy-consent:${row._id}`,
        providerApiVersion: LEGACY_FUNDING_API_VERSION,
        enabled: row.enabled,
        operationVersion: version,
        ...(row.operationPending
          ? {
              pending: {
                enabled: row.targetEnabled!,
                providerKey: `example_balance_${row.subscriptionId}_${version}`,
                requestKey: `legacy-apply:${row._id}:${version}`,
              },
            }
          : {}),
      },
    );
    const link = row.componentMigration ?? {
      accountId: args.accountId,
      scopeKey,
      preparationId: imported.preparationId,
      snapshot: args.snapshot,
      state: "imported" as const,
      ...(imported.operation ? { operation: imported.operation } : {}),
    };
    await ctx.db.patch("storeBalanceFunding", row._id, {
      componentMigration: link,
    });
    return link;
  },
});

export const activate = internalMutation({
  args: { fundingId: v.id("storeBalanceFunding") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("storeBalanceFunding", args.fundingId);
    const link = row?.componentMigration;
    if (
      !row ||
      !link ||
      !row.migrationPaused ||
      (await legacySnapshot(row)) !== link.snapshot
    )
      throw new Error("Legacy funding checkpoint changed.");
    const seller = await ctx.db.get("users", row.sellerId);
    if (
      seller?.role !== "seller" ||
      seller.stripeAccountId !== link.accountId ||
      seller.storePlan?.stripeSubscriptionId !== row.subscriptionId
    )
      throw new Error("Legacy funding account/subscription identity changed.");
    const saved = await ctx.runQuery(
      components.betterStripe.balanceFunding.queries.readPreparation,
      {
        accountId: link.accountId,
        scopeKey: link.scopeKey,
        preparationId: link.preparationId,
        stripeSubscriptionId: row.subscriptionId,
      },
    );
    if (!saved?.verified || saved.activeOperationId)
      throw new Error(
        "Pending legacy operation requires reconciliation before activation.",
      );
    await ctx.runMutation(
      components.betterStripe.balanceFunding.mutations.setStartsPaused,
      {
        accountId: link.accountId,
        scopeKey: link.scopeKey,
        preparationId: link.preparationId,
        stripeSubscriptionId: row.subscriptionId,
        paused: false,
      },
    );
    await ctx.db.patch("storeBalanceFunding", row._id, {
      componentMigration: { ...link, state: "active" },
    });
    return null;
  },
});

/** Compatibility rollback is allowed only before any new component operation. */
export const rollback = internalMutation({
  args: { fundingId: v.id("storeBalanceFunding") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (
      await ctx.db
        .query("storeBalanceMigrationRuns")
        .withIndex("by_key", (q) => q.eq("key", "component-cutover"))
        .unique()
    )
      throw new Error(
        "Global cutover is fenced; use a reviewed deployment rollback and reverse mapping.",
      );
    const row = await ctx.db.get("storeBalanceFunding", args.fundingId);
    const link = row?.componentMigration;
    if (!row || !link) throw new Error("Migration checkpoint is missing.");
    const seller = await ctx.db.get("users", row.sellerId);
    if (
      seller?.role !== "seller" ||
      seller.stripeAccountId !== link.accountId ||
      seller.storePlan?.stripeSubscriptionId !== row.subscriptionId
    )
      throw new Error("Legacy funding account/subscription identity changed.");
    const saved = await ctx.runQuery(
      components.betterStripe.balanceFunding.queries.readPreparation,
      {
        accountId: link.accountId,
        scopeKey: link.scopeKey,
        preparationId: link.preparationId,
        stripeSubscriptionId: row.subscriptionId,
      },
    );
    if (
      (await legacySnapshot(row)) !== link.snapshot ||
      !saved?.verified ||
      saved.activeOperationId ||
      saved.operationVersion !== (row.operationVersion ?? 0) ||
      saved.enabled !== row.enabled
    )
      throw new Error(
        "Operation history changed; reconcile and verify reverse mapping before rollback.",
      );
    await ctx.runMutation(
      components.betterStripe.balanceFunding.mutations.setStartsPaused,
      {
        accountId: link.accountId,
        scopeKey: link.scopeKey,
        preparationId: link.preparationId,
        stripeSubscriptionId: row.subscriptionId,
        paused: true,
      },
    );
    await ctx.db.patch("storeBalanceFunding", row._id, {
      migrationPaused: false,
      componentMigration: { ...link, state: "rolled_back" },
    });
    return null;
  },
});
