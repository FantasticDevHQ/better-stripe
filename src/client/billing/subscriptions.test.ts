/**
 * Tests for the subscription methods. The interesting logic lives in the
 * Stripe-mutating helpers — `cancelSubscription`'s cancel-now vs
 * cancel-at-period-end branch, `updateSubscriptionQuantity`'s retrieve +
 * no-items guard, and `syncAllSubscriptions`' per-record metadata extraction,
 * customer-id normalisation, trial derivation, and error accumulation. The
 * remaining functions are thin component query/mutation delegators verified
 * for the exact ref + args they forward and the shape they return.
 */
import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import {
  cancelSubscription,
  createSubscription,
  getActiveSubscription,
  groupSubscriptionsByStore,
  getSubscription,
  getSubscriptionByStripeId,
  getTrialStatus,
  listStripeSubscriptions,
  listSubscriptions,
  listSubscriptionsByOrg,
  listSubscriptionsByUser,
  reactivateSubscription,
  syncAllSubscriptions,
  updateSubscriptionQuantity,
  upsertSubscription,
} from "./subscriptions.js";

const TO_REF = Symbol.for("toReferencePath");

/** Component proxy exposing the billing refs these functions resolve. */
function makeComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    billing: {
      queries: {
        getSubscription: ref("billing/queries/getSubscription"),
        getSubscriptionByStripeId: ref(
          "billing/queries/getSubscriptionByStripeId",
        ),
        listSubscriptions: ref("billing/queries/listSubscriptions"),
        listSubscriptionsByUser: ref("billing/queries/listSubscriptionsByUser"),
        listSubscriptionsByOrg: ref("billing/queries/listSubscriptionsByOrg"),
        getActiveSubscription: ref("billing/queries/getActiveSubscription"),
        getTrialStatus: ref("billing/queries/getTrialStatus"),
      },
      mutations: {
        upsertSubscription: ref("billing/mutations/upsertSubscription"),
      },
    },
  } as unknown as Component;
}

function makeCtx(queryResult?: unknown) {
  return {
    runQuery: vi.fn().mockResolvedValue(queryResult),
    runMutation: vi.fn().mockResolvedValue(undefined),
  } as unknown as RunCtx & {
    runQuery: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  };
}

function makeStripe() {
  return {
    subscriptions: {
      create: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      retrieve: vi.fn(),
      list: vi.fn(),
    },
    subscriptionItems: {
      update: vi.fn(),
    },
  };
}

const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof cancelSubscription>[0];

/** Build an async-iterable Stripe list result over the given pages. */
function asyncIterable<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

/** Pull the ref's resolved reference path out of a runQuery/runMutation call. */
function refPath(call: unknown[]): string {
  return (call[0] as Record<symbol, string>)[TO_REF];
}

// =============================================================================
// Read delegators
// =============================================================================

describe("getSubscription", () => {
  it("queries getSubscription with the opts and returns the row", async () => {
    const ctx = makeCtx({ stripeSubscriptionId: "sub_1" });
    const result = await getSubscription(makeComponent(), ctx, {
      subscriptionId: "internal_1",
    });

    expect(result).toEqual({ stripeSubscriptionId: "sub_1" });
    expect(refPath(ctx.runQuery.mock.calls[0])).toBe(
      "betterStripe/billing/queries/getSubscription",
    );
    expect(ctx.runQuery.mock.calls[0][1]).toEqual({ subscriptionId: "internal_1" });
  });

  it("returns null when the row is missing", async () => {
    const ctx = makeCtx(null);
    const result = await getSubscription(makeComponent(), ctx, {
      subscriptionId: "missing",
    });
    expect(result).toBeNull();
  });
});

describe("getSubscriptionByStripeId", () => {
  it("queries getSubscriptionByStripeId and forwards the stripe id", async () => {
    const ctx = makeCtx({ stripeSubscriptionId: "sub_x" });
    const result = await getSubscriptionByStripeId(makeComponent(), ctx, {
      stripeSubscriptionId: "sub_x",
    });

    expect(result).toEqual({ stripeSubscriptionId: "sub_x" });
    expect(refPath(ctx.runQuery.mock.calls[0])).toBe(
      "betterStripe/billing/queries/getSubscriptionByStripeId",
    );
    expect(ctx.runQuery.mock.calls[0][1]).toEqual({
      stripeSubscriptionId: "sub_x",
    });
  });
});

describe("listSubscriptionsByUser", () => {
  it("queries listSubscriptionsByUser and returns the rows", async () => {
    const ctx = makeCtx([{ stripeSubscriptionId: "sub_a" }]);
    const result = await listSubscriptionsByUser(makeComponent(), ctx, {
      userId: "user_1",
      status: "active",
    });

    expect(result).toHaveLength(1);
    expect(refPath(ctx.runQuery.mock.calls[0])).toBe(
      "betterStripe/billing/queries/listSubscriptionsByUser",
    );
    expect(ctx.runQuery.mock.calls[0][1]).toEqual({
      userId: "user_1",
      status: "active",
    });
  });
});

describe("listSubscriptionsByOrg", () => {
  it("queries listSubscriptionsByOrg and forwards the org id", async () => {
    const ctx = makeCtx([]);
    await listSubscriptionsByOrg(makeComponent(), ctx, { orgId: "org_1" });

    expect(refPath(ctx.runQuery.mock.calls[0])).toBe(
      "betterStripe/billing/queries/listSubscriptionsByOrg",
    );
    expect(ctx.runQuery.mock.calls[0][1]).toEqual({ orgId: "org_1" });
  });
});

describe("getActiveSubscription", () => {
  it("queries getActiveSubscription and returns the row", async () => {
    const ctx = makeCtx({ stripeSubscriptionId: "sub_active" });
    const result = await getActiveSubscription(makeComponent(), ctx, {
      userId: "user_1",
      orgId: "org_1",
    });

    expect(result).toEqual({ stripeSubscriptionId: "sub_active" });
    expect(refPath(ctx.runQuery.mock.calls[0])).toBe(
      "betterStripe/billing/queries/getActiveSubscription",
    );
    expect(ctx.runQuery.mock.calls[0][1]).toEqual({
      userId: "user_1",
      orgId: "org_1",
    });
  });

  it("returns null when there is no active subscription", async () => {
    const ctx = makeCtx(null);
    const result = await getActiveSubscription(makeComponent(), ctx, {
      userId: "user_none",
    });
    expect(result).toBeNull();
  });
});

describe("getTrialStatus", () => {
  it("queries getTrialStatus and passes the subscription id through", async () => {
    const ctx = makeCtx({ isTrialing: true });
    const result = await getTrialStatus(makeComponent(), ctx, {
      subscriptionId: "internal_1",
    });

    expect(result).toEqual({ isTrialing: true });
    expect(refPath(ctx.runQuery.mock.calls[0])).toBe(
      "betterStripe/billing/queries/getTrialStatus",
    );
    expect(ctx.runQuery.mock.calls[0][1]).toEqual({
      subscriptionId: "internal_1",
    });
  });
});

describe("listSubscriptions", () => {
  it("defaults opts to an empty arg object when called without opts", async () => {
    const ctx = makeCtx([]);
    await listSubscriptions(makeComponent(), ctx);

    expect(refPath(ctx.runQuery.mock.calls[0])).toBe(
      "betterStripe/billing/queries/listSubscriptions",
    );
    expect(ctx.runQuery.mock.calls[0][1]).toEqual({});
  });

  it("renames stripeAccountId to accountId and forwards remaining filters", async () => {
    const ctx = makeCtx([{ stripeSubscriptionId: "sub_1" }]);
    const result = await listSubscriptions(makeComponent(), ctx, {
      stripeAccountId: "acct_1",
      status: "active",
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(ctx.runQuery.mock.calls[0][1]).toEqual({
      accountId: "acct_1",
      status: "active",
      limit: 10,
    });
  });

  it("omits accountId entirely when stripeAccountId is not provided", async () => {
    const ctx = makeCtx([]);
    await listSubscriptions(makeComponent(), ctx, { status: "canceled" });

    const args = ctx.runQuery.mock.calls[0][1] as Record<string, unknown>;
    expect(args).toEqual({ status: "canceled" });
    expect("accountId" in args).toBe(false);
  });
});

// =============================================================================
// Stripe-mutating helpers
// =============================================================================

describe("cancelSubscription", () => {
  it("defaults to cancel-at-period-end (update, not cancel)", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.update.mockResolvedValue({});
    const ctx = makeCtx();

    const result = await cancelSubscription(asStripe(stripe), ctx, {
      stripeSubscriptionId: "sub_1",
    });

    expect(result).toEqual({ success: true });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("honours cancelAtPeriodEnd:true explicitly", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.update.mockResolvedValue({});
    const ctx = makeCtx();

    await cancelSubscription(asStripe(stripe), ctx, {
      stripeSubscriptionId: "sub_2",
      cancelAtPeriodEnd: true,
    });

    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_2", {
      cancel_at_period_end: true,
    });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("cancels immediately when cancelAtPeriodEnd is false", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.cancel.mockResolvedValue({});
    const ctx = makeCtx();

    const result = await cancelSubscription(asStripe(stripe), ctx, {
      stripeSubscriptionId: "sub_3",
      cancelAtPeriodEnd: false,
    });

    expect(result).toEqual({ success: true });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_3");
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe("reactivateSubscription", () => {
  it("clears cancel_at_period_end and returns success", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.update.mockResolvedValue({});
    const ctx = makeCtx();

    const result = await reactivateSubscription(asStripe(stripe), ctx, {
      stripeSubscriptionId: "sub_1",
    });

    expect(result).toEqual({ success: true });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: false,
    });
  });
});

describe("updateSubscriptionQuantity", () => {
  it("retrieves the subscription and updates the first item's quantity", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: "si_1" }, { id: "si_2" }] },
    });
    stripe.subscriptionItems.update.mockResolvedValue({});
    const ctx = makeCtx();

    const result = await updateSubscriptionQuantity(asStripe(stripe), ctx, {
      stripeSubscriptionId: "sub_1",
      quantity: 5,
    });

    expect(result).toEqual({ success: true });
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(stripe.subscriptionItems.update).toHaveBeenCalledWith("si_1", {
      quantity: 5,
    });
  });

  it("throws SUBSCRIPTION_UPDATE_FAILED when the subscription has no items", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [] },
    });
    const ctx = makeCtx();

    await expect(
      updateSubscriptionQuantity(asStripe(stripe), ctx, {
        stripeSubscriptionId: "sub_empty",
        quantity: 2,
      }),
    ).rejects.toMatchObject({ data: { code: "SUBSCRIPTION_UPDATE_FAILED" } });

    expect(stripe.subscriptionItems.update).not.toHaveBeenCalled();
  });

  it("throws SUBSCRIPTION_UPDATE_FAILED when items is entirely absent", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({});
    const ctx = makeCtx();

    await expect(
      updateSubscriptionQuantity(asStripe(stripe), ctx, {
        stripeSubscriptionId: "sub_noitems",
        quantity: 3,
      }),
    ).rejects.toMatchObject({ data: { code: "SUBSCRIPTION_UPDATE_FAILED" } });
  });
});

// =============================================================================
// listStripeSubscriptions (Stripe paginated iterator)
// =============================================================================

describe("listStripeSubscriptions", () => {
  it("collects every subscription with default status 'all' and limit 100", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.list.mockReturnValue(
      asyncIterable([{ id: "sub_a" }, { id: "sub_b" }]),
    );
    const ctx = makeCtx();

    const result = await listStripeSubscriptions(asStripe(stripe), ctx);

    expect(result.map((s) => s.id)).toEqual(["sub_a", "sub_b"]);
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      status: "all",
      limit: 100,
    });
  });

  it("forwards an explicit status and limit", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.list.mockReturnValue(asyncIterable([]));
    const ctx = makeCtx();

    await listStripeSubscriptions(asStripe(stripe), ctx, {
      status: "active",
      limit: 25,
    });

    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      status: "active",
      limit: 25,
    });
  });

  it("stops at `limit` instead of draining every page (BTS-101)", async () => {
    const stripe = makeStripe();
    let yielded = 0;
    stripe.subscriptions.list.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        for (const item of [
          { id: "sub_a" },
          { id: "sub_b" },
          { id: "sub_c" },
          { id: "sub_d" },
        ]) {
          yielded++;
          yield item;
        }
      },
    });
    const ctx = makeCtx();

    const result = await listStripeSubscriptions(asStripe(stripe), ctx, {
      limit: 2,
    });

    expect(result.map((s) => s.id)).toEqual(["sub_a", "sub_b"]);
    expect(yielded).toBe(2);
  });
});

// =============================================================================
// upsertSubscription
// =============================================================================

describe("upsertSubscription", () => {
  it("runs the upsert mutation with the opts and returns null", async () => {
    const ctx = makeCtx();
    const result = await upsertSubscription(makeComponent(), ctx, {
      stripeSubscriptionId: "sub_1",
      userId: "user_1",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    expect(result).toBeNull();
    expect(refPath(ctx.runMutation.mock.calls[0])).toBe(
      "betterStripe/billing/mutations/upsertSubscription",
    );
    expect(ctx.runMutation.mock.calls[0][1]).toMatchObject({
      stripeSubscriptionId: "sub_1",
      userId: "user_1",
      status: "active",
    });
  });

  it("throws when ctx has no runMutation (runMutationOrThrow guard)", async () => {
    const ctx = { runQuery: vi.fn() } as unknown as RunCtx;

    await expect(
      upsertSubscription(makeComponent(), ctx, {
        stripeSubscriptionId: "sub_1",
        userId: "user_1",
        status: "active",
        cancelAtPeriodEnd: false,
        isTrialing: false,
      }),
    ).rejects.toThrow(/requires a Convex ctx with runMutation/);
  });
});

// =============================================================================
// syncAllSubscriptions
// =============================================================================

describe("syncAllSubscriptions", () => {
  it("normalises metadata, customer, items, and trial fields into the upsert", async () => {
    const stripe = makeStripe();
    // current_period_start = 2021-01-01T00:00:00Z (epoch 1609459200)
    // current_period_end   = 2021-02-01T00:00:00Z (epoch 1612137600)
    stripe.subscriptions.list.mockReturnValue(
      asyncIterable([
        {
          id: "sub_1",
          customer: { id: "cus_1" },
          status: "trialing",
          cancel_at_period_end: false,
          canceled_at: null,
          trial_start: 1609459200,
          trial_end: 1612137600,
          metadata: { userId: "user_1", orgId: "org_1" },
          items: {
            data: [
              {
                id: "si_1",
                price: { id: "price_1" },
                quantity: 3,
                current_period_start: 1609459200,
                current_period_end: 1612137600,
              },
            ],
          },
        },
      ]),
    );
    const ctx = makeCtx();

    const result = await syncAllSubscriptions(
      asStripe(stripe),
      makeComponent(),
      ctx,
    );

    expect(result).toEqual({ synced: 1, errors: [], errorCount: 0 });

    expect(refPath(ctx.runMutation.mock.calls[0])).toBe(
      "betterStripe/billing/mutations/upsertSubscription",
    );
    expect(ctx.runMutation.mock.calls[0][1]).toEqual({
      stripeSubscriptionId: "sub_1",
      accountId: "cus_1",
      userId: "user_1",
      orgId: "org_1",
      status: "trialing",
      priceId: "price_1",
      quantity: 3,
      currentPeriodStart: "2021-01-01T00:00:00.000Z",
      currentPeriodEnd: "2021-02-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      canceledAt: undefined,
      isTrialing: true,
      trialStart: "2021-01-01T00:00:00.000Z",
      trialEnd: "2021-02-01T00:00:00.000Z",
      metadata: { userId: "user_1", orgId: "org_1" },
    });
  });

  it("uses a string customer id directly and snake_case metadata keys", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.list.mockReturnValue(
      asyncIterable([
        {
          id: "sub_2",
          customer: "cus_2",
          status: "active",
          cancel_at_period_end: true,
          canceled_at: null,
          trial_start: null,
          trial_end: null,
          metadata: { user_id: "user_2", org_id: "org_2" },
          items: { data: [{ id: "si_2", price: { id: "price_2" }, quantity: 1 }] },
        },
      ]),
    );
    const ctx = makeCtx();

    await syncAllSubscriptions(asStripe(stripe), makeComponent(), ctx);

    expect(ctx.runMutation.mock.calls[0][1]).toMatchObject({
      accountId: "cus_2",
      userId: "user_2",
      orgId: "org_2",
      isTrialing: false,
      trialStart: undefined,
      trialEnd: undefined,
    });
  });

  it("falls back to userId '' and undefined optionals when metadata/items are missing", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.list.mockReturnValue(
      asyncIterable([
        {
          id: "sub_3",
          customer: null,
          status: "active",
          cancel_at_period_end: false,
          canceled_at: null,
          trial_start: null,
          trial_end: null,
          metadata: undefined,
          items: { data: [] },
        },
      ]),
    );
    const ctx = makeCtx();

    await syncAllSubscriptions(asStripe(stripe), makeComponent(), ctx);

    expect(ctx.runMutation.mock.calls[0][1]).toMatchObject({
      accountId: "",
      userId: "",
      orgId: undefined,
      priceId: undefined,
      quantity: undefined,
      currentPeriodStart: undefined,
      currentPeriodEnd: undefined,
      metadata: undefined,
    });
  });

  it("accumulates per-record errors and keeps syncing the rest", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.list.mockReturnValue(
      asyncIterable([
        {
          id: "sub_bad",
          customer: "cus_bad",
          status: "active",
          cancel_at_period_end: false,
          metadata: {},
          items: { data: [] },
        },
        {
          id: "sub_good",
          customer: "cus_good",
          status: "active",
          cancel_at_period_end: false,
          metadata: {},
          items: { data: [] },
        },
      ]),
    );
    const ctx = makeCtx();
    // First upsert throws, second succeeds.
    ctx.runMutation
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    const result = await syncAllSubscriptions(
      asStripe(stripe),
      makeComponent(),
      ctx,
    );

    expect(result.synced).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.errors).toEqual(["Subscription sub_bad: boom"]);
  });

  it("labels a non-Error thrown value as 'Unknown error'", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.list.mockReturnValue(
      asyncIterable([
        {
          id: "sub_weird",
          customer: "cus_weird",
          status: "active",
          cancel_at_period_end: false,
          metadata: {},
          items: { data: [] },
        },
      ]),
    );
    const ctx = makeCtx();
    ctx.runMutation.mockRejectedValueOnce("not-an-error");

    const result = await syncAllSubscriptions(
      asStripe(stripe),
      makeComponent(),
      ctx,
    );

    expect(result).toEqual({
      synced: 0,
      errors: ["Subscription sub_weird: Unknown error"],
      errorCount: 1,
    });
  });

  it("returns a zero result for an empty subscription list", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.list.mockReturnValue(asyncIterable([]));
    const ctx = makeCtx();

    const result = await syncAllSubscriptions(
      asStripe(stripe),
      makeComponent(),
      ctx,
    );

    expect(result).toEqual({ synced: 0, errors: [], errorCount: 0 });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});

describe("createSubscription (BTS-17)", () => {
  function createdSub(overrides: Record<string, unknown> = {}) {
    return {
      id: "sub_new",
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: { id: "price_1" },
            quantity: 1,
            current_period_start: 1000,
            current_period_end: 2000,
          },
        ],
      },
      metadata: { userId: "buyer_1" },
      ...overrides,
    };
  }

  it("creates a single-recipient subscription with destination + percent fee", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.create.mockResolvedValue(createdSub());
    const ctx = makeCtx();

    const result = await createSubscription(asStripe(stripe), makeComponent(), ctx, {
      userId: "buyer_1",
      customerAccount: "acct_buyer",
      stripePriceId: "price_1",
      destinationAccountId: "acct_store",
      feeConfig: { percent: 10 },
    });

    const createArg = stripe.subscriptions.create.mock.calls[0][0];
    expect(createArg.customer_account).toBe("acct_buyer");
    expect(createArg.items).toEqual([{ price: "price_1" }]);
    expect(createArg.transfer_data).toEqual({ destination: "acct_store" });
    expect(createArg.application_fee_percent).toBe(10);
    expect(createArg.payment_method_types).toBeUndefined();

    const [, upsertArgs] = ctx.runMutation.mock.calls[0];
    expect(upsertArgs).toMatchObject({
      stripeSubscriptionId: "sub_new",
      accountId: "acct_buyer",
      userId: "buyer_1",
      status: "active",
      chargeType: "destination",
      destinationAccountId: "acct_store",
      applicationFeePercent: 10,
    });
    expect(result).toEqual({ stripeSubscriptionId: "sub_new", status: "active" });
  });

  it("flags percent+fixed fees for per-invoice computation", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.create.mockResolvedValue(createdSub());
    const ctx = makeCtx();

    await createSubscription(asStripe(stripe), makeComponent(), ctx, {
      userId: "buyer_1",
      customerAccount: "acct_buyer",
      stripePriceId: "price_1",
      destinationAccountId: "acct_store",
      feeConfig: { percent: 2.9, fixed: 30 },
    });

    const createArg = stripe.subscriptions.create.mock.calls[0][0];
    expect(createArg.transfer_data).toEqual({ destination: "acct_store" });
    expect(createArg.application_fee_percent).toBeUndefined();
    expect(createArg.metadata.bsFeeMode).toBe("per_invoice");
  });

  it("creates a plain subscription without destination/fee", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.create.mockResolvedValue(createdSub());
    const ctx = makeCtx();

    await createSubscription(asStripe(stripe), makeComponent(), ctx, {
      userId: "buyer_1",
      customerAccount: "acct_buyer",
      stripePriceId: "price_1",
    });

    const createArg = stripe.subscriptions.create.mock.calls[0][0];
    expect(createArg.transfer_data).toBeUndefined();
    expect(createArg.application_fee_percent).toBeUndefined();
    const [, upsertArgs] = ctx.runMutation.mock.calls[0];
    expect(upsertArgs.chargeType).toBeUndefined();
  });

  it("routes a >1 split via separate charges (markers on subscription metadata)", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.create.mockResolvedValue(createdSub());
    const ctx = makeCtx();

    await createSubscription(asStripe(stripe), makeComponent(), ctx, {
      userId: "buyer_1",
      customerAccount: "acct_buyer",
      stripePriceId: "price_1",
      split: [
        { destinationAccountId: "acct_store", role: "store", percent: 80 },
        { destinationAccountId: "acct_aff", role: "affiliate", percent: 5 },
      ],
      feeConfig: { percent: 10 },
    });

    const createArg = stripe.subscriptions.create.mock.calls[0][0];
    expect(createArg.transfer_data).toBeUndefined();
    expect(createArg.application_fee_percent).toBeUndefined();
    expect(createArg.metadata.bsChargeType).toBe("separate");
    expect(JSON.parse(createArg.metadata.bsSplit)).toHaveLength(2);

    const [, upsertArgs] = ctx.runMutation.mock.calls[0];
    expect(upsertArgs.chargeType).toBe("separate");
    expect(upsertArgs.splitRecipients).toHaveLength(2);
  });

  it("treats a single-recipient split as a destination charge", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.create.mockResolvedValue(createdSub());
    const ctx = makeCtx();

    await createSubscription(asStripe(stripe), makeComponent(), ctx, {
      userId: "buyer_1",
      customerAccount: "acct_buyer",
      stripePriceId: "price_1",
      split: [{ destinationAccountId: "acct_store", role: "store", percent: 90 }],
      feeConfig: { percent: 10 },
    });

    const createArg = stripe.subscriptions.create.mock.calls[0][0];
    expect(createArg.transfer_data).toEqual({ destination: "acct_store" });
    expect(createArg.application_fee_percent).toBe(10);
  });

  it("rejects feeConfig without a destinationAccountId", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx();

    await expect(
      createSubscription(asStripe(stripe), makeComponent(), ctx, {
        userId: "buyer_1",
        customerAccount: "acct_buyer",
        stripePriceId: "price_1",
        feeConfig: { percent: 10 },
      }),
    ).rejects.toThrow(/destinationAccountId/);
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it("surfaces Stripe failures as structured errors", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.create.mockRejectedValue(new Error("card_declined"));
    const ctx = makeCtx();

    await expect(
      createSubscription(asStripe(stripe), makeComponent(), ctx, {
        userId: "buyer_1",
        customerAccount: "acct_buyer",
        stripePriceId: "price_1",
      }),
    ).rejects.toThrow();
  });
});

describe("groupSubscriptionsByStore (BTS-19)", () => {
  it("groups a buyer's subscriptions by store, preserving first-seen order", () => {
    const subs: { stripeSubscriptionId: string; destinationAccountId?: string }[] =
      [
        { stripeSubscriptionId: "s1", destinationAccountId: "store_a" },
        { stripeSubscriptionId: "s2", destinationAccountId: "store_b" },
        { stripeSubscriptionId: "s3", destinationAccountId: "store_a" },
        { stripeSubscriptionId: "s4" }, // no store → platform-direct
      ];

    const grouped = groupSubscriptionsByStore(subs);

    expect(grouped.map((g) => g.storeAccountId)).toEqual([
      "store_a",
      "store_b",
      null,
    ]);
    expect(
      grouped[0].subscriptions.map((s) => s.stripeSubscriptionId),
    ).toEqual(["s1", "s3"]);
    expect(grouped[1].subscriptions.map((s) => s.stripeSubscriptionId)).toEqual([
      "s2",
    ]);
    expect(grouped[2].subscriptions.map((s) => s.stripeSubscriptionId)).toEqual([
      "s4",
    ]);
  });

  it("returns an empty array for no subscriptions", () => {
    expect(groupSubscriptionsByStore([])).toEqual([]);
  });
});

describe("createSubscription — per-store statement descriptor (BTS-32)", () => {
  function createdSub() {
    return {
      id: "sub_sd",
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: { id: "price_1" },
            quantity: 1,
            current_period_start: 1000,
            current_period_end: 2000,
          },
        ],
      },
      metadata: { userId: "buyer_1" },
    };
  }

  it("stashes bsStatementDescriptor from the store's account alongside per-invoice fee markers", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.create.mockResolvedValue(createdSub());
    const ctx = makeCtx({ statementDescriptor: "MAYAS FITNESS" });

    await createSubscription(asStripe(stripe), makeComponent(), ctx, {
      userId: "buyer_1",
      customerAccount: "acct_buyer",
      stripePriceId: "price_1",
      destinationAccountId: "acct_store",
      feeConfig: { percent: 2.9, fixed: 30 },
    });

    const params = stripe.subscriptions.create.mock.calls[0][0];
    expect(params.metadata.bsStatementDescriptor).toBe("MAYAS FITNESS");
    expect(params.metadata.bsFeeMode).toBe("per_invoice");
  });

  it("falls back to the provided platform default when the store has no suffix", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.create.mockResolvedValue(createdSub());
    const ctx = makeCtx({}); // account record without statementDescriptor

    await createSubscription(asStripe(stripe), makeComponent(), ctx, {
      userId: "buyer_1",
      customerAccount: "acct_buyer",
      stripePriceId: "price_1",
      destinationAccountId: "acct_store",
      defaultStatementDescriptorSuffix: "PLATFORM DEF",
    });

    const params = stripe.subscriptions.create.mock.calls[0][0];
    expect(params.metadata.bsStatementDescriptor).toBe("PLATFORM DEF");
  });

  it("adds no marker and performs no account lookup without a destination", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.create.mockResolvedValue(createdSub());
    const ctx = makeCtx();

    await createSubscription(asStripe(stripe), makeComponent(), ctx, {
      userId: "buyer_1",
      customerAccount: "acct_buyer",
      stripePriceId: "price_1",
      defaultStatementDescriptorSuffix: "PLATFORM DEF",
    });

    const params = stripe.subscriptions.create.mock.calls[0][0];
    expect(params.metadata.bsStatementDescriptor).toBeUndefined();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });
});
