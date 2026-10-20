import { storePlanIdValidator } from "../storePlans/validators";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  env,
} from "../_generated/server";
import { demoActor } from "../meteredUsage/authorization";
import { storeEnabled } from "./catalog";
import { enrollmentDoc, enrollmentRef } from "./schema";
export const prepare = internalMutation({
  args: { actorId: v.id("users"), offerId: v.id("meteredProductOffers") },
  returns: v.id("meteredProductEnrollments"),
  handler: async (ctx, args) => {
    const actor = await demoActor(ctx, args.actorId);
    if (!["customer", "buyer", "seller"].includes(actor.role))
      throw new Error("Choose a customer persona to purchase this service.");
    const saved = await ctx.db
      .query("meteredProductEnrollments")
      .withIndex("by_buyer_offer", (q) =>
        q.eq("buyerId", actor._id).eq("offerId", args.offerId),
      )
      .unique();
    if (saved) return saved._id;
    const offer = await ctx.db.get("meteredProductOffers", args.offerId);
    const owner = offer && (await ctx.db.get("users", offer.ownerId));
    if (!offer?.providerJson || !owner || !(await storeEnabled(ctx, owner)))
      throw new Error(
        "This product's metered billing is disabled or not ready.",
      );
    if (actor._id === owner._id)
      throw new Error("Use a customer persona to enroll in your product.");
    return ctx.db.insert("meteredProductEnrollments", {
      returnOrigin: env.FRONTEND_URL ?? "http://localhost:5173",
      buyerId: actor._id,
      offerId: offer._id,
      createdAt: Date.now(),
    });
  },
});
export const read = internalQuery({
  args: enrollmentRef,
  returns: enrollmentDoc,
  handler: async (ctx, args) => {
    await demoActor(ctx, args.actorId);
    const row = await ctx.db.get(
      "meteredProductEnrollments",
      args.enrollmentId,
    );
    if (!row || row.buyerId !== args.actorId)
      throw new Error("Original enrollment is unavailable.");
    return row;
  },
});
export const current = query({
  args: { actorId: v.id("users"), offerId: v.id("meteredProductOffers") },
  returns: v.union(enrollmentDoc, v.null()),
  handler: async (ctx, args) => {
    await demoActor(ctx, args.actorId);
    return ctx.db
      .query("meteredProductEnrollments")
      .withIndex("by_buyer_offer", (q) =>
        q.eq("buyerId", args.actorId).eq("offerId", args.offerId),
      )
      .unique();
  },
});
export const pin = internalMutation({
  args: {
    ...enrollmentRef,
    settlementPlanId: v.optional(storePlanIdValidator),
    payerJson: v.optional(v.string()),
    checkoutJson: v.optional(v.string()),
    providerJson: v.optional(v.string()),
    initialInvoiceId: v.optional(v.string()),
    observedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await demoActor(ctx, args.actorId);
    const row = await ctx.db.get(
      "meteredProductEnrollments",
      args.enrollmentId,
    );
    if (!row || row.buyerId !== args.actorId)
      throw new Error("Original enrollment is unavailable.");
    for (const key of [
      "payerJson",
      "initialInvoiceId",
      "settlementPlanId",
    ] as const)
      if (row[key] && args[key] && row[key] !== args[key])
        throw new Error("Original enrollment identity cannot change.");
    if (
      args.providerJson &&
      (args.observedAt === undefined ||
        (row.observedAt !== undefined &&
          (args.observedAt < row.observedAt ||
            (args.observedAt === row.observedAt &&
              args.providerJson !== row.providerJson))))
    )
      throw new Error(
        "A newer subscription observation is retained. Refresh before retrying.",
      );
    if (
      args.checkoutJson &&
      row.checkoutJson &&
      JSON.parse(args.checkoutJson).id !== JSON.parse(row.checkoutJson).id
    )
      throw new Error("Original checkout identity cannot change.");
    await ctx.db.patch("meteredProductEnrollments", row._id, {
      ...(args.settlementPlanId !== undefined
        ? { settlementPlanId: args.settlementPlanId }
        : {}),
      ...(args.payerJson !== undefined ? { payerJson: args.payerJson } : {}),
      ...(args.checkoutJson !== undefined
        ? {
            checkoutJson: args.checkoutJson,
            checkoutId: JSON.parse(args.checkoutJson).id,
          }
        : {}),
      ...(args.providerJson !== undefined
        ? { providerJson: args.providerJson, observedAt: args.observedAt }
        : {}),
      ...(args.initialInvoiceId !== undefined
        ? { initialInvoiceId: args.initialInvoiceId }
        : {}),
    });
    return null;
  },
});

/** Original native Checkout indexes webhook ownership. Bounded fallback retains older enrollments. */
export const forCheckout = internalQuery({
  args: { checkoutId: v.string() },
  returns: v.union(enrollmentDoc, v.null()),
  handler: async (ctx, args) => {
    const indexed = await ctx.db
      .query("meteredProductEnrollments")
      .withIndex("by_checkout", (q) => q.eq("checkoutId", args.checkoutId))
      .unique();
    if (indexed) return indexed;
    const legacy = await ctx.db.query("meteredProductEnrollments").take(101);
    if (legacy.length > 100)
      throw new Error(
        "Backfill original metered enrollment Checkout indexes before settlement.",
      );
    const matches = legacy.filter(
      (row) =>
        row.checkoutJson && JSON.parse(row.checkoutJson).id === args.checkoutId,
    );
    if (matches.length > 1)
      throw new Error("Original Checkout enrollment is ambiguous.");
    return matches[0] ?? null;
  },
});
/** A disabled store cannot create another checkout. Previously paid sessions can still be reconciled. */
export const canCheckout = internalQuery({
  args: enrollmentRef,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await demoActor(ctx, args.actorId);
    const enrollment = await ctx.db.get(
      "meteredProductEnrollments",
      args.enrollmentId,
    );
    if (!enrollment || enrollment.buyerId !== args.actorId)
      throw new Error("Original enrollment is unavailable.");
    const offer = await ctx.db.get("meteredProductOffers", enrollment.offerId);
    const owner = offer && (await ctx.db.get("users", offer.ownerId));
    return !!owner && (await storeEnabled(ctx, owner));
  },
});
