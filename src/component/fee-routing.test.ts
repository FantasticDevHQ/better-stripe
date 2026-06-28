// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

describe("fee & fund-routing fields (BTS-11)", () => {
  it("persists destination + fee fields on a payment and reads them back", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_fee",
      userId: "user_1",
      amount: 10000,
      currency: "usd",
      status: "succeeded",
      destinationAccountId: "acct_store",
      applicationFeeAmount: 1000,
      feeCollectedAmount: 1000,
      chargeType: "destination",
    });

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_fee",
    });
    expect(payment).not.toBeNull();
    expect(payment!.destinationAccountId).toBe("acct_store");
    expect(payment!.applicationFeeAmount).toBe(1000);
    expect(payment!.feeCollectedAmount).toBe(1000);
    expect(payment!.chargeType).toBe("destination");
  });

  it("persists a multi-recipient split on a subscription and reads it back", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_split",
      userId: "user_1",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
      chargeType: "separate",
      applicationFeePercent: 10,
      splitRecipients: [
        { destinationAccountId: "acct_store", role: "store", percent: 80 },
        { destinationAccountId: "acct_aff", role: "affiliate", percent: 10 },
      ],
    });

    const sub = await t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: "sub_split",
    });
    expect(sub).not.toBeNull();
    expect(sub!.chargeType).toBe("separate");
    expect(sub!.applicationFeePercent).toBe(10);
    expect(sub!.splitRecipients).toHaveLength(2);
    expect(sub!.splitRecipients![1]).toMatchObject({
      destinationAccountId: "acct_aff",
      role: "affiliate",
      percent: 10,
    });
  });

  it("rejects a split recipient with an unknown role", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.connect.mutations.upsertPayment, {
        stripePaymentIntentId: "pi_bad",
        userId: "user_1",
        amount: 10000,
        currency: "usd",
        status: "succeeded",
        chargeType: "separate",
        splitRecipients: [
          // `role` must be one of store|affiliate|other — invalid at runtime
          { destinationAccountId: "acct_x", role: "platform", amount: 100 },
        ] as never,
      }),
      // Convex's union error reports the rejected value, not the field path, so
      // pin to the validator rejecting the bad role literal specifically.
    ).rejects.toThrow(/Validator error.*platform/i);
  });
});
