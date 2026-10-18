import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { limitPolicy } from "../../client/usage/allowanceTerms.js";
import {
  terms,
  json,
  policyRow,
  overlapping,
  active,
  history,
  canonical,
  scopeOverlap,
} from "./helpers.js";
import {
  reserve as reserveUnits,
  release as releaseUnits,
} from "./reservations.js";
import { scopeValidator } from "../usage/schema.js";
export const configure = mutation({
  args: {
    bindingJson: v.string(),
    policyJson: v.string(),
    expectedRevision: v.number(),
  },
  returns: v.object({ revision: v.number() }),
  handler: async (ctx, args) => {
    const original = terms(json(args.bindingJson)),
      policy = limitPolicy(json(args.policyJson), original.binding),
      policyJson = canonical(policy);
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 0
    )
      throw new Error("Invalid allowance policy revision");
    await active(ctx, original.binding);
    const prior =
      (await overlapping(
        ctx,
        original.nativeKey,
        original.binding.subscription.period,
      )) ??
      (await scopeOverlap(
        ctx,
        original.scopeKey,
        original.binding.subscription.period,
      ));
    if (prior) {
      if (
        prior.key !== original.key ||
        prior.bindingJson !== original.bindingJson
      )
        throw new Error("Overlapping allowance terms cannot reset usage");
      if (prior.policyJson === policyJson) return { revision: prior.revision };
      if (prior.revision !== args.expectedRevision)
        throw new Error("Stale allowance policy revision");
      await ctx.db.patch("usageAllowancePolicies", prior._id, {
        policyJson,
        revision: prior.revision + 1,
      });
      await history(ctx, prior, "policy", {
        revision: prior.revision + 1,
        policy,
        previousPolicy: JSON.parse(prior.policyJson),
      });
      return { revision: prior.revision + 1 };
    }
    if (args.expectedRevision !== 0)
      throw new Error("Stale allowance policy revision");
    // Enable accounting before any accepted usage in this scope/period. Existing
    // unaccounted history must be reconciled rather than silently granting units.
    const existing = await ctx.db
      .query("usageEvents")
      .withIndex("by_scope_time", (q) =>
        q
          .eq("scopeKey", original.scopeKey)
          .gte("occurredAt", original.binding.subscription.period.start)
          .lt("occurredAt", original.binding.subscription.period.end),
      )
      .first();
    if (existing)
      throw new Error(
        "Existing period usage requires reconciliation before allowance setup",
      );
    const id = await ctx.db.insert("usageAllowancePolicies", {
      key: original.key,
      nativeKey: original.nativeKey,
      scopeKey: original.scopeKey,
      bindingJson: original.bindingJson,
      start: original.binding.subscription.period.start,
      end: original.binding.subscription.period.end,
      policyJson,
      revision: 1,
      consumed: "0",
      reserved: "0",
      historyCount: 0,
    });
    const row = await policyRow(ctx, original.key);
    if (!row || row._id !== id)
      throw new Error("Allowance setup invariant violated");
    await history(ctx, row, "policy", { revision: 1, policy });
    return { revision: 1 };
  },
});
export const reserve = mutation({
  args: { inputJson: v.string(), subscriptionJson: v.string() },
  returns: v.union(
    v.object({
      state: v.literal("denied"),
      reason: v.union(v.literal("not_entitled"), v.literal("hard_limit")),
      revision: v.number(),
    }),
    v.object({
      reservationId: v.id("usageReservations"),
      state: v.union(
        v.literal("reserved"),
        v.literal("committed"),
        v.literal("released"),
      ),
      revision: v.number(),
    }),
  ),
  handler: (ctx, args) =>
    reserveUnits(ctx, args.inputJson, args.subscriptionJson),
});
export const release = mutation({
  args: {
    scope: scopeValidator,
    reservationId: v.id("usageReservations"),
    reason: v.union(
      v.literal("work_failed"),
      v.literal("abandoned_before_work"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await releaseUnits(ctx, args.scope, args.reservationId, args.reason);
    return null;
  },
});
