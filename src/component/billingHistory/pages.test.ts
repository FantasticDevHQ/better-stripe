import type { PaginationResult } from "convex/server";
import type { Doc } from "../_generated/dataModel.js";
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

it("pages all 67 original buyer Checkout rows instead of the legacy first50", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 67; i++)
    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: `cs_history_${i}`,
      userId: "buyer_original",
      ...(i % 2 ? { accountId: "acct_original" } : {}),
      mode: i % 2 ? "subscription" : "payment",
      status: "complete",
    });
  expect(
    await t.query(api.billing.queries.listCheckoutSessionsByUser, {
      userId: "buyer_original",
    }),
  ).toHaveLength(50);
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 8; i++) {
    const result: PaginationResult<Doc<"checkoutSessions">> = await t.query(
      api.billingHistory.queries.paginateCheckoutSessions,
      {
        userId: "buyer_original",
        paginationOpts: { numItems: 17, cursor },
      },
    );
    ids.push(...result.page.map((row) => row.stripeSessionId));
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  expect(new Set(ids).size).toBe(67);
  expect(ids).toHaveLength(67);
});

it("pages 67 recurring and trial rows including accountless legacy subscriptions", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 67; i++)
    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: `sub_history_${i}`,
      userId: "buyer_original",
      ...(i % 2 ? { accountId: "acct_original" } : {}),
      status: i % 2 ? "active" : "trialing",
      isTrialing: i % 2 === 0,
      cancelAtPeriodEnd: false,
    });
  expect(
    await t.query(api.billing.queries.listSubscriptionsByUser, {
      userId: "buyer_original",
    }),
  ).toHaveLength(67);
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 8; i++) {
    const result: PaginationResult<Doc<"subscriptions">> = await t.query(
      api.billingHistory.queries.paginateSubscriptions,
      {
        userId: "buyer_original",
        paginationOpts: { numItems: 17, cursor },
      },
    );
    ids.push(...result.page.map((row) => row.stripeSubscriptionId));
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  expect(new Set(ids).size).toBe(67);
  expect(ids).toHaveLength(67);
});
