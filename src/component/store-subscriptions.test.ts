import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.*s");
it("scopes seller subscriptions by catalog price for both destination and split sales", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const [id, priceId] of [
      ["sub_direct", "price_seller"],
      ["sub_referred", "price_seller"],
      ["sub_other", "price_other"],
    ]) {
      await ctx.db.insert("subscriptions", {
        stripeSubscriptionId: id,
        priceId,
        userId: "customer",
        status: "active",
        cancelAtPeriodEnd: false,
        isTrialing: false,
        isCollectionPaused: false,
      });
    }
  });
  const rows = await t.query(api.billing.queries.listSubscriptionsByPrice, {
    priceId: "price_seller",
  });
  expect(rows.map((s) => s.stripeSubscriptionId).sort()).toEqual([
    "sub_direct",
    "sub_referred",
  ]);
});
