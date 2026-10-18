import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { schema, modules } from "../../test";
import componentSchema from "../../../dist/component/schema.js";
import { components } from "../../convex/_generated/api";
const componentModules = import.meta.glob("../../../dist/component/**/*.js");

/** Existing settlement seed data; no provider action or invented original cash. */
export async function seedStoreSale(
  planId: "starter" | "growth" | "pro",
  referred: boolean,
) {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
    stripeProductId: "prod_default",
    accountId: "acct_store",
    name: "Membership",
    active: true,
  });
  await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
    stripePriceId: "price_default",
    stripeProductId: "prod_default",
    productId: "product",
    unitAmount: 10000,
    currency: "usd",
    type: "recurring",
    interval: "month",
    active: true,
  });
  workflowTest.register(t, "betterStripe/workflow");
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
      storePlan: {
        planId,
        status: "active",
        paidThrough: Date.now() + 86400000,
        stripeSubscriptionId: "sub_store",
        cancelAtPeriodEnd: false,
      },
    }),
  );
  if (referred)
    await t.run((ctx) =>
      ctx.db.insert("affiliateDefaults", {
        affiliateBasisPoints: 2000,
        affiliateFixedAmount: null,
        version: 1,
      }),
    );
  return { t, sellerId };
}
