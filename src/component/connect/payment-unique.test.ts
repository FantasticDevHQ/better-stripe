// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

async function fixture() {
  const t = convexTest(schema, modules);
  const paymentId = await t.run((ctx) =>
    ctx.db.insert("payments", {
      stripePaymentIntentId: "pi_original_history",
      userId: "original_buyer",
      accountId: "acct_original_buyer",
      destinationAccountId: "acct_original_merchant",
      chargeType: "destination",
      amount: 123,
      currency: "usd",
      status: "succeeded",
    }),
  );
  return { t, paymentId };
}

it("retains the existing unique-row and legacy duplicate first-row positives", async () => {
  const f = await fixture();
  const args = { stripePaymentIntentId: "pi_original_history" };
  const original = await f.t.query(
    api.connect.queries.getPaymentByStripeId,
    args,
  );
  expect(original).toMatchObject({
    _id: f.paymentId,
    userId: "original_buyer",
  });
  await f.t.run(async (ctx) => {
    if (!original) throw new Error("Missing actual original payment");
    const { _id: _id, _creationTime: _creationTime, ...fields } = original;
    await ctx.db.insert("payments", {
      ...fields,
      userId: "foreign_buyer",
      accountId: "acct_foreign_buyer",
      destinationAccountId: "acct_foreign_merchant",
      currency: "eur",
      status: "failed",
    });
  });
  expect(
    await f.t.query(api.connect.queries.getPaymentByStripeId, args),
  ).toEqual(original);
});

it("returns null for globally ambiguous exact PI when uniqueness is explicitly required", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.insert("payments", {
      stripePaymentIntentId: "pi_original_history",
      userId: "foreign_buyer",
      orgId: "foreign_org",
      accountId: "acct_foreign_buyer",
      destinationAccountId: "acct_foreign_merchant",
      chargeType: "destination",
      amount: 123,
      currency: "eur",
      status: "failed",
    }),
  );
  const args = {
    stripePaymentIntentId: "pi_original_history",
    requireUnique: true,
  };
  await expect(
    f.t.query(api.connect.queries.getPaymentByStripeId, args),
  ).resolves.toBeNull();
});

it("returns null for a missing exact PI when uniqueness is required", async () => {
  const f = await fixture();
  const args = { stripePaymentIntentId: "pi_missing", requireUnique: true };
  expect(
    await f.t.query(api.connect.queries.getPaymentByStripeId, args),
  ).toBeNull();
});

it("returns the unchanged sole original document without filtering failed state or currency", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch("payments", f.paymentId, {
      currency: "jpy",
      status: "failed",
      amount: 123,
    }),
  );
  const args = {
    stripePaymentIntentId: "pi_original_history",
    requireUnique: true,
  };
  const stored = await f.t.run((ctx) => ctx.db.get("payments", f.paymentId));
  expect(
    await f.t.query(api.connect.queries.getPaymentByStripeId, args),
  ).toEqual(stored);
});

it("preserves explicit false first-row behavior on duplicate original PIs", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.insert("payments", {
      stripePaymentIntentId: "pi_original_history",
      userId: "foreign_buyer",
      amount: 1,
      currency: "eur",
      status: "failed",
    }),
  );
  const args = {
    stripePaymentIntentId: "pi_original_history",
    requireUnique: false,
  };
  expect(
    await f.t.query(api.connect.queries.getPaymentByStripeId, args),
  ).toMatchObject({ _id: f.paymentId });
});

it.each([
  { userId: "foreign_buyer" },
  { orgId: "foreign_org" },
  { accountId: "acct_replacement" },
  { destinationAccountId: "acct_foreign_merchant" },
  { currency: "eur" },
  { status: "failed" },
] as const)(
  "holds global duplicate PI before qualification of %j",
  async (changed) => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const original = await ctx.db.get("payments", f.paymentId);
      if (!original) throw new Error("Missing original");
      const { _id: _id, _creationTime: _creationTime, ...fields } = original;
      await ctx.db.insert("payments", { ...fields, ...changed });
    });
    const args = {
      stripePaymentIntentId: "pi_original_history",
      requireUnique: true,
    };
    expect(
      await f.t.query(api.connect.queries.getPaymentByStripeId, args),
    ).toBeNull();
  },
);

it("does not depend on whether a matching or foreign duplicate was inserted first", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    await ctx.db.insert("payments", {
      stripePaymentIntentId: "pi_foreign_first",
      userId: "foreign_buyer",
      amount: 1,
      currency: "eur",
      status: "failed",
    });
    await ctx.db.insert("payments", {
      stripePaymentIntentId: "pi_foreign_first",
      userId: "original_buyer",
      amount: 123,
      currency: "usd",
      status: "succeeded",
    });
  });
  const args = {
    stripePaymentIntentId: "pi_foreign_first",
    requireUnique: true,
  };
  expect(
    await f.t.query(api.connect.queries.getPaymentByStripeId, args),
  ).toBeNull();
});

it("does not confuse unrelated PIs with ambiguity of the exact requested key", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.insert("payments", {
      stripePaymentIntentId: "pi_unrelated_original",
      userId: "original_buyer",
      amount: 123,
      currency: "usd",
      status: "succeeded",
    }),
  );
  const args = {
    stripePaymentIntentId: "pi_original_history",
    requireUnique: true,
  };
  expect(
    await f.t.query(api.connect.queries.getPaymentByStripeId, args),
  ).toMatchObject({ _id: f.paymentId });
});
