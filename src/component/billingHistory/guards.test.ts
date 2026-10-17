// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

async function fixture() {
  const t = convexTest(schema, modules);
  for (const userId of ["original", "foreign"])
    for (let i = 0; i < 6; i++) {
      await t.mutation(api.billing.mutations.upsertCheckoutSession, {
        stripeSessionId: `cs_${userId}_${i}`,
        userId,
        ...(i > 1 ? { accountId: i > 3 ? "acct_other" : "acct_original" } : {}),
        mode: "payment",
        status: i % 2 ? "complete" : "open",
      });
      await t.mutation(api.billing.mutations.upsertSubscription, {
        stripeSubscriptionId: `sub_${userId}_${i}`,
        userId,
        ...(i > 1 ? { accountId: i > 3 ? "acct_other" : "acct_original" } : {}),
        status: i % 2 ? "active" : "trialing",
        isTrialing: i % 2 === 0,
        cancelAtPeriodEnd: false,
      });
    }
  return t;
}

it("uses conjunctive original buyer/account/status scope and retains accountless user rows", async () => {
  const t = await fixture();
  const checkout = await t.query(
    api.billingHistory.queries.paginateCheckoutSessions,
    {
      userId: "original",
      accountId: "acct_original",
      status: "complete",
      paginationOpts: { cursor: null, numItems: 10 },
    },
  );
  expect(checkout.page.map((row) => row.stripeSessionId)).toEqual([
    "cs_original_3",
  ]);
  const subscriptions = await t.query(
    api.billingHistory.queries.paginateSubscriptions,
    {
      userId: "original",
      accountId: "acct_original",
      status: "trialing",
      paginationOpts: { cursor: null, numItems: 10 },
    },
  );
  expect(subscriptions.page.map((row) => row.stripeSubscriptionId)).toEqual([
    "sub_original_2",
  ]);
  const legacy = await t.query(
    api.billingHistory.queries.paginateSubscriptions,
    {
      userId: "original",
      paginationOpts: { cursor: null, numItems: 10 },
    },
  );
  expect(legacy.page).toHaveLength(6);
  expect(legacy.page.filter((row) => row.accountId === undefined)).toHaveLength(
    2,
  );
});

it("rejects exchanged kinds and changed user/account/status continuation scopes", async () => {
  const t = await fixture();
  const args = {
    userId: "original",
    paginationOpts: { cursor: null, numItems: 1 },
  };
  const first = await t.query(
    api.billingHistory.queries.paginateCheckoutSessions,
    args,
  );
  expect(first.isDone).toBe(false);
  const paginationOpts = { cursor: first.continueCursor, numItems: 1 };
  for (const changed of [
    { userId: "foreign" },
    { accountId: "acct_original" },
    { status: "complete" as const },
  ])
    await expect(
      t.query(api.billingHistory.queries.paginateCheckoutSessions, {
        ...args,
        ...changed,
        paginationOpts,
      }),
    ).rejects.toThrow("cursor or scope");
  await expect(
    t.query(api.billingHistory.queries.paginateSubscriptions, {
      userId: "original",
      paginationOpts,
    }),
  ).rejects.toThrow("cursor or scope");
});

it.each([0, -1, 101, 1.5])(
  "rejects invalid page size %s without returning a preview",
  async (numItems) => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.billingHistory.queries.paginateSubscriptions, {
        userId: "original",
        paginationOpts: { cursor: null, numItems },
      }),
    ).rejects.toThrow("selector or page size");
  },
);

it("rejects empty ownership selectors and malformed cursors", async () => {
  const t = convexTest(schema, modules);
  for (const args of [
    { userId: "" },
    { userId: " " },
    { userId: "original", accountId: "" },
  ])
    await expect(
      t.query(api.billingHistory.queries.paginateCheckoutSessions, {
        ...args,
        paginationOpts: { cursor: null, numItems: 1 },
      }),
    ).rejects.toThrow("selector or page size");
  await expect(
    t.query(api.billingHistory.queries.paginateCheckoutSessions, {
      userId: "original",
      paginationOpts: { cursor: "not-a-cursor", numItems: 1 },
    }),
  ).rejects.toThrow("cursor or scope");
});

it("returns an explicit exhausted empty page for an authorized empty buyer scope", async () => {
  const t = await fixture();
  const result = await t.query(
    api.billingHistory.queries.paginateSubscriptions,
    {
      userId: "empty",
      paginationOpts: { cursor: null, numItems: 10 },
    },
  );
  expect(result).toMatchObject({ page: [], isDone: true });
});

it("preserves native pinned range growth and scope-bound split continuation", async () => {
  const t = await fixture();
  const scope = { userId: "original" };
  const first = await t.query(
    api.billingHistory.queries.paginateCheckoutSessions,
    {
      ...scope,
      paginationOpts: { cursor: null, numItems: 2 },
    },
  );
  for (let i = 0; i < 220; i++)
    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: `cs_growth_${i}`,
      userId: "original",
      mode: "payment",
      status: "complete",
    });
  const grown = await t.query(
    api.billingHistory.queries.paginateCheckoutSessions,
    {
      ...scope,
      paginationOpts: {
        cursor: null,
        endCursor: first.continueCursor,
        numItems: 2,
      },
    },
  );
  expect(grown.pageStatus).toBe("SplitRequired");
  expect(grown.splitCursor).toBeTruthy();
  const prefix = await t.query(
    api.billingHistory.queries.paginateCheckoutSessions,
    {
      ...scope,
      paginationOpts: {
        cursor: null,
        endCursor: grown.splitCursor,
        numItems: 2,
      },
    },
  );
  const suffix = await t.query(
    api.billingHistory.queries.paginateCheckoutSessions,
    {
      ...scope,
      paginationOpts: {
        cursor: grown.splitCursor!,
        endCursor: first.continueCursor,
        numItems: 2,
      },
    },
  );
  expect(
    new Set([...prefix.page, ...suffix.page].map((row) => row.stripeSessionId))
      .size,
  ).toBe(222);
  await expect(
    t.query(api.billingHistory.queries.paginateCheckoutSessions, {
      userId: "foreign",
      paginationOpts: {
        cursor: null,
        endCursor: grown.splitCursor,
        numItems: 2,
      },
    }),
  ).rejects.toThrow("cursor or scope");
});

it("preserves exact Unicode and longer legacy buyer IDs without inventing a new length cap", async () => {
  const t = convexTest(schema, modules);
  for (const userId of ["buyer_東京", `legacy_${"a".repeat(600)}`]) {
    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: `sub_${userId}`,
      userId,
      status: "active",
      isTrialing: false,
      cancelAtPeriodEnd: false,
    });
    const result = await t.query(
      api.billingHistory.queries.paginateSubscriptions,
      {
        userId,
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );
    expect(result.page).toHaveLength(1);
    expect(result.page[0]?.userId).toBe(userId);
  }
});
