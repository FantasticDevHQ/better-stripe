import { componentsGeneric, type FunctionReference } from "convex/server";
import { expect, it } from "vitest";

import schema from "../component/schema.js";
import type { Component, RunCtx } from "./helpers.js";
import { BetterStripe, type RefundPageOptions } from "./index.js";
import { initConvexTest } from "./setup.test.js";

const modules = import.meta.glob("../component/**/*.{ts,js,tsx,jsx}");

it("reads multiple conjunctively scoped pages through the public client without provider credentials", async () => {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const component = componentsGeneric().betterStripe as unknown as Component;
  const stripe = new BetterStripe(component, {});
  const ctx = {
    runQuery: (
      ref: FunctionReference<"query">,
      args: Record<string, unknown>,
    ) => t.query(ref, args),
  } as unknown as RunCtx;
  for (let index = 0; index < 5; index++) {
    await t.mutation(component.connect.mutations.upsertRefund, {
      stripeRefundId: `re_${index}`,
      accountId: index === 4 ? "acct_foreign" : "acct_owner",
      stripePaymentIntentId: index === 3 ? "pi_foreign" : "pi_original",
      stripeChargeId: "ch_original",
      amount: 500,
      currency: "jpy",
      status: "succeeded",
    });
  }
  const opts: RefundPageOptions = {
    stripeAccountId: "acct_owner",
    stripePaymentIntentId: "pi_original",
    status: "succeeded",
    paginationOpts: { numItems: 2, cursor: null },
  };
  const first = await stripe.paginateRefunds(ctx, opts);
  expect(first.page).toHaveLength(2);
  expect(first.isDone).toBe(false);
  const last = await stripe.paginateRefunds(ctx, {
    ...opts,
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(last.isDone).toBe(true);
  expect([...first.page, ...last.page]).toHaveLength(3);
  for (const refund of [...first.page, ...last.page]) {
    expect(refund).toMatchObject({
      accountId: "acct_owner",
      stripePaymentIntentId: "pi_original",
      stripeChargeId: "ch_original",
      amount: 500,
      currency: "jpy",
      status: "succeeded",
    });
  }
  expect(
    await stripe.paginateRefunds(ctx, {
      ...opts,
      stripeAccountId: "acct_absent",
    }),
  ).toMatchObject({ page: [], isDone: true });
  expect(
    await stripe.listRefunds(ctx, { stripeAccountId: "acct_owner", limit: 1 }),
  ).toHaveLength(1);
});
