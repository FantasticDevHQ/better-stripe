import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { stripe } from "../stripe/helpers";
import { demoActor } from "../meteredUsage/authorization";
import { parseDemoConfiguration } from "../meteredUsage/policy";
import { assertProductOwner } from "./policy";
import { offerDoc } from "./schema";
export async function storeEnabled(
  ctx: Pick<QueryCtx, "db">,
  seller: Doc<"users">,
) {
  if (seller.role === "admin") return true;
  const setting = await ctx.db
    .query("meteredStoreSettings")
    .withIndex("by_seller", (q) => q.eq("sellerId", seller._id))
    .unique();
  return (
    setting?.enabled ??
    (seller.role === "seller" && seller.email === "maya@example.com")
  );
}
export const enabled = query({
  args: { actorId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, args) =>
    storeEnabled(ctx, await demoActor(ctx, args.actorId)),
});
export const setEnabled = mutation({
  args: {
    actorId: v.id("users"),
    sellerId: v.id("users"),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if ((await demoActor(ctx, args.actorId)).role !== "admin")
      throw new Error("Only an admin can enable metered billing for stores.");
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller") throw new Error("Select a seller store.");
    const saved = await ctx.db
      .query("meteredStoreSettings")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .unique();
    if (saved)
      await ctx.db.patch("meteredStoreSettings", saved._id, {
        enabled: args.enabled,
      });
    else
      await ctx.db.insert("meteredStoreSettings", {
        sellerId: args.sellerId,
        enabled: args.enabled,
      });
    return null;
  },
});
export const stores = query({
  args: { actorId: v.id("users") },
  returns: v.array(
    v.object({ id: v.id("users"), name: v.string(), enabled: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    if ((await demoActor(ctx, args.actorId)).role !== "admin")
      throw new Error("An admin persona is required.");
    const sellers = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "seller"))
      .take(100);
    return Promise.all(
      sellers
        .filter((seller) => !seller.testFixture)
        .map(async (seller) => ({
          id: seller._id,
          name: seller.storeName ?? seller.name,
          enabled: await storeEnabled(ctx, seller),
        })),
    );
  },
});
export const prepare = internalMutation({
  args: {
    actorId: v.id("users"),
    productId: v.string(),
    baseAmount: v.number(),
    configurationJson: v.string(),
  },
  returns: v.id("meteredProductOffers"),
  handler: async (ctx, args): Promise<Id<"meteredProductOffers">> => {
    const actor = await demoActor(ctx, args.actorId);
    if (!["admin", "seller"].includes(actor.role))
      throw new Error("Configure metered billing on your own product.");
    if (!(await storeEnabled(ctx, actor)))
      throw new Error("Metered billing is disabled for this store.");
    const raw = JSON.parse(args.configurationJson);
    const config = parseDemoConfiguration(
      args.configurationJson,
      raw.plan?.model,
    );
    if (
      config.plan.rate.currency !== "usd" ||
      config.plan.unit.precision !== 0 ||
      !/^[1-9]\d{0,5}$/.test(config.plan.rate.unitAmountDecimal)
    )
      throw new Error(
        "This example supports USD, whole units and whole minor-unit rates only.",
      );
    if (
      config.creditPackage &&
      BigInt(config.creditPackage.quantity) *
        BigInt(config.plan.rate.unitAmountDecimal) >
        99999999n
    )
      throw new Error(
        "Credit packages must fit the native payment amount bound.",
      );
    const identity = await stripe.getProductIdentity(ctx, {
      stripeProductId: args.productId,
    });
    if (identity.status !== "unique")
      throw new Error("Select an original catalog product.");
    assertProductOwner(actor, identity.product, config.plan.model);
    if (
      !Number.isSafeInteger(args.baseAmount) ||
      args.baseAmount < 0 ||
      args.baseAmount > 10000000 ||
      (config.plan.model === "included_overage" && args.baseAmount === 0) ||
      (config.plan.model === "prepaid" && args.baseAmount !== 0)
    )
      throw new Error(
        "Use a positive monthly base price for included usage, or zero for prepaid credits.",
      );
    const configurationJson = JSON.stringify(config);
    const saved = await ctx.db
      .query("meteredProductOffers")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .unique();
    if (saved) {
      if (
        saved.ownerId !== actor._id ||
        saved.baseAmount !== args.baseAmount ||
        saved.configurationJson !== configurationJson
      )
        throw new Error(
          "Retain the original product terms. Create another product for new terms.",
        );
      return saved._id;
    }
    return ctx.db.insert("meteredProductOffers", {
      ownerId: actor._id,
      productId: args.productId,
      productName: identity.product.name,
      baseAmount: args.baseAmount,
      configurationJson,
      createdAt: Date.now(),
    });
  },
});
export const read = internalQuery({
  args: { actorId: v.id("users"), offerId: v.id("meteredProductOffers") },
  returns: offerDoc,
  handler: async (ctx, args) => {
    await demoActor(ctx, args.actorId);
    const row = await ctx.db.get("meteredProductOffers", args.offerId);
    if (!row) throw new Error("Original product terms are unavailable.");
    return row;
  },
});
export const pin = internalMutation({
  args: {
    actorId: v.id("users"),
    offerId: v.id("meteredProductOffers"),
    providerJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await demoActor(ctx, args.actorId);
    const row = await ctx.db.get("meteredProductOffers", args.offerId);
    if (
      !row ||
      row.ownerId !== args.actorId ||
      (row.providerJson && row.providerJson !== args.providerJson)
    )
      throw new Error("Original product binding cannot change.");
    await ctx.db.patch("meteredProductOffers", row._id, {
      providerJson: args.providerJson,
    });
    return null;
  },
});
export const list = query({
  args: { actorId: v.id("users") },
  returns: v.array(offerDoc),
  handler: async (ctx, args) => {
    const actor = await demoActor(ctx, args.actorId);
    // The example has a bounded catalog. No invoices, usage or payment history live here.
    if (actor.role === "seller" || actor.role === "admin")
      return ctx.db
        .query("meteredProductOffers")
        .withIndex("by_owner", (q) => q.eq("ownerId", actor._id))
        .take(100);
    const sellers = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "seller"))
      .take(100);
    const admins = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .take(10);
    const groups = await Promise.all(
      [...sellers, ...admins]
        .filter((owner) => !owner.testFixture)
        .map(async (owner) =>
          (await storeEnabled(ctx, owner))
            ? ctx.db
                .query("meteredProductOffers")
                .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
                .take(100)
            : [],
        ),
    );
    const purchases = await ctx.db
      .query("meteredProductEnrollments")
      .withIndex("by_buyer_offer", (q) => q.eq("buyerId", actor._id))
      .take(100);
    const retained = await Promise.all(
      purchases.map((purchase) =>
        ctx.db.get("meteredProductOffers", purchase.offerId),
      ),
    );
    return [
      ...new Map(
        [
          ...groups.flat().filter((row) => row.providerJson),
          ...retained.filter(
            (row): row is Doc<"meteredProductOffers"> => row !== null,
          ),
        ].map((row) => [row._id, row]),
      ).values(),
    ];
  },
});
export const actor = internalQuery({
  args: { actorId: v.id("users") },
  returns: v.object({
    id: v.id("users"),
    role: v.string(),
    name: v.string(),
    email: v.string(),
    stripeAccountId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await demoActor(ctx, args.actorId);
    return {
      id: user._id,
      role: user.role,
      name: user.name,
      email: user.email,
      stripeAccountId: user.stripeAccountId,
    };
  },
});
export const products = query({
  args: {
    actorId: v.id("users"),
    cursor: v.optional(v.string()),
    selectedProductId: v.optional(v.string()),
  },
  returns: v.object({
    products: v.array(v.object({ id: v.string(), name: v.string() })),
    cursor: v.string(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await demoActor(ctx, args.actorId);
    if (
      !["admin", "seller"].includes(user.role) ||
      (user.role === "seller" && !user.stripeAccountId)
    )
      return { products: [], cursor: "", done: true };
    const accountId = user.role === "seller" ? user.stripeAccountId : undefined;
    const page = await stripe.paginateProducts(ctx, {
      accountId,
      active: true,
      paginationOpts: { numItems: 50, cursor: args.cursor ?? null },
    });
    const products = page.page.filter(
      (product) =>
        !product.metadata?.bsUsageDemo && product.accountId === accountId,
    );
    if (
      args.selectedProductId &&
      !products.some((p) => p.stripeProductId === args.selectedProductId)
    ) {
      const identity = await stripe.getProductIdentity(ctx, {
        stripeProductId: args.selectedProductId,
      });
      if (
        identity.status === "unique" &&
        identity.product.active &&
        !identity.product.metadata?.bsUsageDemo &&
        identity.product.accountId === accountId
      )
        products.push(identity.product);
    }
    return {
      products: products.map((product) => ({
        id: product.stripeProductId,
        name: product.name,
      })),
      cursor: page.continueCursor,
      done: page.isDone,
    };
  },
});
export const assertRegularPrice = internalQuery({
  args: { productId: v.string(), priceId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const offer = await ctx.db
      .query("meteredProductOffers")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .unique();
    const provider = offer?.providerJson
      ? (JSON.parse(offer.providerJson) as {
          basePriceId: string | null;
          price: { stripePriceId: string };
        })
      : null;
    if (provider)
      throw new Error(
        "Use the metered product enrollment to purchase its base fee and usage together.",
      );
    return null;
  },
});
