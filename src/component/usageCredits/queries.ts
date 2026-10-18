import { scopeValidator } from "../usage/schema.js";
import { scopeKey } from "../usage/helpers.js";
import { account, purchase } from "./helpers.js";
import { creditAllocations } from "./reservations.js";
import type { Id } from "../_generated/dataModel.js";
import { subscriptionSnapshot } from "../usage/helpers.js";
import type { PreparedUsageRecord } from "../../client/usage/records.js";
import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import { intentDoc } from "../usageSubscriptions/schema.js";
import { activeEnrollment } from "./helpers.js";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import schema from "../schema.js";
import { purchaseDoc, grantDoc, historyDoc } from "./schema.js";
import { accountTerms, boundedJson, grants } from "./helpers.js";
import type {
  UsageCreditBinding,
  UsageCreditBalance,
} from "../../client/usage/creditTerms.js";
import { decimalFromScaled } from "../../client/usage/summary.js";
export const getPurchase = query({
  args: { bindingJson: v.string(), purchaseId: v.string() },
  returns: v.union(purchaseDoc, v.null()),
  handler: async (ctx, args) => {
    if (!args.purchaseId || args.purchaseId.length > 100)
      throw new Error("Invalid credit purchase identity");
    const original = await accountTerms(
      boundedJson(args.bindingJson) as UsageCreditBinding,
    );
    const key = await canonicalFingerprint([original.key, args.purchaseId]);
    return ctx.db
      .query("usageCreditPurchases")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
  },
});
export const getByKey = query({
  args: { key: v.string() },
  returns: v.union(purchaseDoc, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("usageCreditPurchases")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique(),
});
export const balance = query({
  args: { bindingJson: v.string() },
  returns: v.object({
    availableQuantity: v.string(),
    reservedQuantity: v.string(),
    consumedQuantity: v.string(),
    expiredQuantity: v.string(),
    frozenQuantity: v.string(),
    precision: v.number(),
    currency: v.string(),
    unit: v.string(),
    status: v.union(v.literal("available"), v.literal("held")),
    cashCollection: v.literal("none"),
  }),
  handler: async (ctx, args): Promise<UsageCreditBalance> => {
    const original = await accountTerms(
      boundedJson(args.bindingJson) as UsageCreditBinding,
    );
    const ledger = await ctx.db
      .query("usageCreditAccounts")
      .withIndex("by_key", (q) => q.eq("key", original.key))
      .unique();
    const rows = ledger ? await grants(ctx, original.key) : [];
    let available = 0n,
      reserved = 0n,
      consumed = 0n,
      expired = 0n,
      frozen = 0n;
    for (const row of rows) {
      reserved += BigInt(row.reserved);
      consumed += BigInt(row.consumed);
      if (row.nativeExpired) expired += BigInt(row.available);
      else if (row.frozen) frozen += BigInt(row.available);
      else if (row.expiresAt !== null && row.expiresAt <= Date.now() / 1000)
        expired += BigInt(row.available);
      else if (row.effectiveAt <= Date.now() / 1000)
        available += BigInt(row.available);
    }
    const plan = original.binding.binding.plan,
      precision = plan.unit.precision;
    const held = !!ledger?.frozenReason || !!ledger?.closed;
    return {
      availableQuantity: decimalFromScaled(held ? 0n : available, precision),
      reservedQuantity: decimalFromScaled(reserved, precision),
      consumedQuantity: decimalFromScaled(consumed, precision),
      expiredQuantity: decimalFromScaled(expired, precision),
      frozenQuantity: decimalFromScaled(
        frozen + (held ? available : 0n),
        precision,
      ),
      precision,
      currency: plan.rate.currency,
      unit: plan.unit.name,
      status: held ? "held" : "available",
      cashCollection: "none",
    };
  },
});
export const readGrants = query({
  args: { bindingJson: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(grantDoc),
  handler: async (ctx, args) => {
    const original = await accountTerms(
      boundedJson(args.bindingJson) as UsageCreditBinding,
    );
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      throw new Error("Credit page limit must be 1–100");
    return paginator(ctx.db, schema)
      .query("usageCreditGrants")
      .withIndex("by_account", (q) => q.eq("accountKey", original.key))
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1000000,
      });
  },
});
export const readHistory = query({
  args: { bindingJson: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(historyDoc),
  handler: async (ctx, args) => {
    const original = await accountTerms(
      boundedJson(args.bindingJson) as UsageCreditBinding,
    );
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      throw new Error("Credit page limit must be 1–100");
    return paginator(ctx.db, schema)
      .query("usageCreditHistory")
      .withIndex("by_account", (q) => q.eq("accountKey", original.key))
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1000000,
      });
  },
});

export const context = query({
  args: { bindingJson: v.string() },
  returns: intentDoc,
  handler: async (ctx, args) => {
    const original = await accountTerms(
      boundedJson(args.bindingJson) as UsageCreditBinding,
    );
    return (await activeEnrollment(ctx, original.binding)).intent;
  },
});

export const invoiceUsage = query({
  args: {
    bindingJson: v.string(),
    subscriptionId: v.string(),
    subscriptionItemId: v.string(),
    start: v.number(),
    end: v.number(),
  },
  returns: v.object({
    complete: v.boolean(),
    valid: v.boolean(),
    scaledQuantity: v.string(),
  }),
  handler: async (ctx, args) => {
    const original = await accountTerms(
      boundedJson(args.bindingJson) as UsageCreditBinding,
    );
    if (
      !Number.isSafeInteger(args.start) ||
      !Number.isSafeInteger(args.end) ||
      args.start >= args.end
    )
      throw new Error("Invalid credit invoice period");
    const rows = await ctx.db
      .query("usageEvents")
      .withIndex("by_scope_subscription_time", (q) =>
        q
          .eq("scopeKey", original.scopeKey)
          .eq("subscriptionId", args.subscriptionId)
          .gte("occurredAt", args.start)
          .lt("occurredAt", args.end),
      )
      .take(501);
    let quantity = 0n,
      valid = true;
    for (const row of rows.slice(0, 500)) {
      const event = JSON.parse(row.recordJson) as PreparedUsageRecord;
      const subscription = subscriptionSnapshot(row.subscriptionJson);
      const binding = await accountTerms(event);
      if (
        binding.key !== original.key ||
        subscription.subscriptionItemId !== args.subscriptionItemId ||
        subscription.period.start !== args.start ||
        subscription.period.end !== args.end
      )
        valid = false;
      const outbox = await ctx.db
        .query("usageOutbox")
        .withIndex("by_event", (q) => q.eq("eventId", row._id))
        .unique();
      const error = await ctx.db
        .query("usageDeliveryErrors")
        .withIndex("by_event", (q) => q.eq("eventId", row._id))
        .first();
      if (outbox?.state !== "provider_accepted" || error) valid = false;
      quantity += BigInt(event.scaledQuantity);
    }
    return {
      complete: rows.length <= 500,
      valid,
      scaledQuantity: quantity.toString(),
    };
  },
});

export const deliveryBacking = query({
  args: { scope: scopeValidator, eventId: v.id("usageEvents") },
  returns: v.object({
    held: v.boolean(),
    purchases: v.array(purchaseDoc),
    grants: v.array(grantDoc),
  }),
  handler: async (ctx, args) => {
    const event = await ctx.db.get("usageEvents", args.eventId);
    if (
      !event ||
      event.scopeKey !== scopeKey(args.scope) ||
      !event.reservationId
    )
      throw new Error("Credit delivery source unavailable");
    const reservation = await ctx.db.get(
      "usageReservations",
      event.reservationId,
    );
    if (
      !reservation ||
      reservation.accountingKind !== "prepaid" ||
      reservation.state !== "committed" ||
      reservation.eventId !== event._id
    )
      throw new Error("Committed credit backing required");
    const original = await accountTerms(
      JSON.parse(event.recordJson) as PreparedUsageRecord,
    );
    const ledger = await account(ctx, original.key);
    const allocations = creditAllocations.parse(
      JSON.parse(reservation.allocationsJson!),
    );
    const selected = [],
      purchases = [];
    for (const allocation of allocations) {
      const grant = await ctx.db.get(
        "usageCreditGrants",
        allocation.grantId as Id<"usageCreditGrants">,
      );
      if (!grant || grant.accountKey !== original.key)
        throw new Error("Credit allocation scope mismatch");
      selected.push(grant);
      purchases.push(await purchase(ctx, grant.purchaseKey));
    }
    return {
      held:
        ledger.closed ||
        !!ledger.frozenReason ||
        selected.some((g) => g.frozen),
      grants: selected,
      purchases,
    };
  },
});

export const capacity = query({
  args: { bindingJson: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const { binding } = await accountTerms(
      boundedJson(args.bindingJson) as UsageCreditBinding,
    );
    const key = JSON.stringify([
      binding.scope.stripeAccountId,
      binding.scope.livemode,
      binding.binding.stripeCustomerId,
    ]);
    const rows = await ctx.db
      .query("usageCreditPurchases")
      .withIndex("by_customer_capacity", (q) =>
        q.eq("nativeCustomerKey", key).eq("capacityReserved", true),
      )
      .take(101);
    return rows.length;
  },
});
