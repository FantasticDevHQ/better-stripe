// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

const ID = "sub_ordering";
const base = {
  stripeSubscriptionId: ID,
  userId: "user_ordering",
  cancelAtPeriodEnd: false,
  isTrialing: false,
};
const setup = () => {
  const t = convexTest(schema, modules);
  const upsert = (
    status: "active" | "canceled" | "past_due" | "trialing",
    lastEventCreated?: number,
    extra: { priceId?: string; quantity?: number } = {},
  ) =>
    t.mutation(api.billing.mutations.upsertSubscription, {
      ...base,
      ...extra,
      status,
      ...(lastEventCreated === undefined ? {} : { lastEventCreated }),
    });
  const row = () =>
    t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: ID,
    });
  return { t, upsert, row };
};

describe("billing — upsertSubscription event-time watermark", () => {
  it("inserts the first event for an unknown subscription with its watermark", async () => {
    const { upsert, row } = setup();
    expect(await upsert("active", 1_700_000_100)).toBeNull();
    expect(await row()).toMatchObject({
      status: "active",
      lastEventCreated: 1_700_000_100,
    });
  });

  it("applies in-order events and advances the watermark", async () => {
    const { upsert, row } = setup();
    await upsert("trialing", 100);
    expect(await upsert("active", 200, { quantity: 2 })).toBeNull();
    expect(await upsert("past_due", 300, { quantity: 3 })).toBeNull();
    expect(await row()).toMatchObject({
      status: "past_due",
      quantity: 3,
      lastEventCreated: 300,
    });
  });

  it("skips a late update that arrives after the deletion", async () => {
    const { upsert, row } = setup();
    await upsert("active", 100, { priceId: "price_original" });
    await upsert("canceled", 300);
    const canceled = await row();

    expect(await upsert("active", 200, { priceId: "price_late" })).toBe(
      "stale",
    );
    expect(await row()).toEqual(canceled);
    expect(canceled).toMatchObject({
      status: "canceled",
      priceId: "price_original",
      lastEventCreated: 300,
    });
  });

  it("does not backfill invoices from a skipped event", async () => {
    const { t, upsert } = setup();
    await upsert("canceled", 300);
    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "in_ordering",
      subscriptionId: ID,
      userId: "",
      status: "paid",
      currency: "usd",
      amountDue: 100,
      amountPaid: 100,
    });
    expect(await upsert("active", 200)).toBe("stale");
    expect(
      await t.query(api.billing.queries.getInvoiceByStripeId, {
        stripeInvoiceId: "in_ordering",
      }),
    ).toMatchObject({ userId: "" });
  });

  it("lets the terminal state win a same-second tie", async () => {
    const { upsert, row } = setup();
    await upsert("canceled", 500);
    expect(await upsert("active", 500)).toBe("stale");
    expect(await row()).toMatchObject({ status: "canceled" });
    // A canceled event in the same second still applies.
    expect(await upsert("canceled", 500, { quantity: 4 })).toBeNull();
    expect(await row()).toMatchObject({ status: "canceled", quantity: 4 });
  });

  it("applies a same-second tie when the stored row is not terminal", async () => {
    const { upsert, row } = setup();
    await upsert("active", 500);
    expect(await upsert("past_due", 500)).toBeNull();
    expect(await upsert("canceled", 500)).toBeNull();
    expect(await row()).toMatchObject({
      status: "canceled",
      lastEventCreated: 500,
    });
  });

  it("applies a direct write without a watermark and preserves the stored one", async () => {
    const { upsert, row } = setup();
    await upsert("active", 500);
    expect(await upsert("past_due", undefined, { quantity: 7 })).toBeNull();
    expect(await row()).toMatchObject({
      status: "past_due",
      quantity: 7,
      lastEventCreated: 500,
    });
    // The preserved watermark still rejects an older event afterwards.
    expect(await upsert("active", 400)).toBe("stale");
    expect(await row()).toMatchObject({ status: "past_due" });
  });

  it("applies a direct write even over a canceled row", async () => {
    const { upsert, row } = setup();
    await upsert("canceled", 500);
    expect(await upsert("active")).toBeNull();
    expect(await row()).toMatchObject({
      status: "active",
      lastEventCreated: 500,
    });
  });

  it("stamps a row written without a watermark on its first event", async () => {
    const { upsert, row } = setup();
    await upsert("active");
    expect((await row())?.lastEventCreated).toBeUndefined();
    expect(await upsert("canceled", 50)).toBeNull();
    expect(await row()).toMatchObject({
      status: "canceled",
      lastEventCreated: 50,
    });
  });
});
