import { setupCredits } from "./accounting.fixtures.js";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  request,
  nativeSubscription,
} from "../../client/usage/subscription.fixtures.js";
const ref = (name: string) =>
  makeFunctionReference<"mutation">(`usageCredits/mutations:${name}`);
const prepare = makeFunctionReference<"mutation">(
  "usageSubscriptions/mutations:prepare",
);
const save = makeFunctionReference<"mutation">(
  "usageSubscriptions/mutations:save",
);
const record = makeFunctionReference<"mutation">("usage/mutations:record");
const balance = makeFunctionReference<"query">("usageCredits/queries:balance");

afterEach(() => vi.useRealTimers());
it("atomically reserves payment-backed units, commits with ledger acceptance and rejects concurrent overspend", async () => {
  const { t, meter, event, subscription } = await setupCredits();
  const args = {
    inputJson: JSON.stringify(event),
    subscriptionJson: JSON.stringify(subscription),
  };
  const first = await t.mutation(ref("reserve"), args);
  expect(await t.mutation(ref("reserve"), args)).toEqual(first);
  await expect(
    t.mutation(ref("reserve"), {
      ...args,
      inputJson: JSON.stringify({ ...event, sourceEventId: "work2" }),
    }),
  ).rejects.toThrow(/insufficient/i);
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({
    availableQuantity: "4",
    reservedQuantity: "6",
    consumedQuantity: "0",
  });
  const receipt = await t.mutation(record, {
    ...args,
    reservationId: first.reservationId,
  });
  expect(
    await t.mutation(record, { ...args, reservationId: first.reservationId }),
  ).toEqual(receipt);
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({
    availableQuantity: "4",
    reservedQuantity: "0",
    consumedQuantity: "6",
    cashCollection: "none",
  });
  await expect(
    t.mutation(ref("release"), {
      scope: meter.scope,
      reservationId: first.reservationId,
      reason: "work_failed",
    }),
  ).rejects.toThrow(/committed/i);
});
it("releases only uncommitted work and rejects changed reservation provenance", async () => {
  const { t, meter, event, subscription } = await setupCredits();
  const args = {
    inputJson: JSON.stringify(event),
    subscriptionJson: JSON.stringify(subscription),
  };
  const first = await t.mutation(ref("reserve"), args);
  await expect(
    t.mutation(record, {
      ...args,
      inputJson: JSON.stringify({ ...event, occurredAt: 701 }),
      reservationId: first.reservationId,
    }),
  ).rejects.toThrow(/reservation/i);
  await expect(
    t.mutation(ref("reserve"), {
      ...args,
      inputJson: JSON.stringify({ ...event, quantity: "5" }),
    }),
  ).rejects.toThrow(/conflict/i);
  await t.mutation(ref("release"), {
    scope: meter.scope,
    reservationId: first.reservationId,
    reason: "abandoned_before_work",
  });
  await t.mutation(ref("release"), {
    scope: meter.scope,
    reservationId: first.reservationId,
    reason: "abandoned_before_work",
  });
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({ availableQuantity: "10", reservedQuantity: "0" });
  expect((await t.mutation(ref("reserve"), args)).state).toBe("released");
});
it("never accepts unpaid grants, reuses original purchase identities and prevents duplicate payment backing", async () => {
  const { t, purchase, row, proof } = await setupCredits();
  expect(
    (
      await t.mutation(ref("preparePurchase"), {
        inputJson: JSON.stringify(purchase),
      })
    ).key,
  ).toBe(row.key);
  await expect(
    t.mutation(ref("preparePurchase"), {
      inputJson: JSON.stringify({ ...purchase, quantity: "11" }),
    }),
  ).rejects.toThrow(/conflict/i);
  const other = await t.mutation(ref("preparePurchase"), {
    inputJson: JSON.stringify({ ...purchase, purchaseId: "topup2" }),
  });
  await expect(
    t.mutation(ref("pinGrant"), {
      key: other.key,
      proofJson: JSON.stringify({
        ...proof,
        creditGrantId: "credgr_other",
        stripePriceId: "price_calls",
        createdAt: 700,
        effectiveAt: 700,
        expiresAt: null,
      }),
    }),
  ).rejects.toThrow(/payment/i);
  await expect(
    t.mutation(ref("pinPayment"), {
      key: other.key,
      paymentIntentId: "pi_topup1",
    }),
  ).rejects.toThrow(/payment/i);
});

it("holds consumption after refund/dispute evidence without releasing committed or reserved backing", async () => {
  const { t, meter, event, subscription, row } = await setupCredits();
  const args = {
    inputJson: JSON.stringify(event),
    subscriptionJson: JSON.stringify(subscription),
  };
  const reservation = await t.mutation(ref("reserve"), args);
  await t.mutation(ref("freezePurchase"), {
    key: row.key,
    paymentIntentId: "pi_topup1",
    reason: "payment_refunded",
  });
  await expect(
    t.mutation(record, { ...args, reservationId: reservation.reservationId }),
  ).rejects.toThrow(/reconciliation|backing/i);
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({
    status: "held",
    availableQuantity: "0",
    reservedQuantity: "6",
    consumedQuantity: "0",
  });
  expect(
    await t.run((ctx) => ctx.db.query("usageEvents").collect()),
  ).toHaveLength(0);
});
it("cannot spend the same last units from two concurrent work requests", async () => {
  const { t, meter, event, subscription } = await setupCredits();
  const results = await Promise.allSettled(
    ["left", "right"].map((sourceEventId) =>
      t.mutation(ref("reserve"), {
        inputJson: JSON.stringify({ ...event, sourceEventId }),
        subscriptionJson: JSON.stringify(subscription),
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({ availableQuantity: "4", reservedQuantity: "6" });
});

it("retains expired units as provenance and closes only fully reconciled credit accounts", async () => {
  const { t, meter, purchase } = await setupCredits();
  await expect(
    t.mutation(ref("closeAccount"), { bindingJson: JSON.stringify(meter) }),
  ).rejects.toThrow(/reconcil|credit/i);
  await t.mutation(ref("saveObservation"), {
    inputJson: JSON.stringify(purchase),
    startedAt: Date.now(),
    proofJson: JSON.stringify({
      creditGrantId: "credgr_topup1",
      paymentIntentId: "pi_topup1",
      currency: "usd",
      ledgerAmount: 0,
      availableAmount: 0,
      granted: 20,
      applied: 0,
      expired: 20,
      voided: 0,
      reinstated: 0,
      invoicesVerified: true,
      complete: true,
      transactions: [
        {
          id: "cbtxn_expire",
          kind: "credits_expired",
          amount: 20,
          invoiceId: null,
          invoiceLineId: null,
        },
      ],
    }),
  });
  expect(
    await t.query(balance, { bindingJson: JSON.stringify(meter) }),
  ).toMatchObject({ availableQuantity: "0", expiredQuantity: "10" });
  await expect(
    t.mutation(ref("closeAccount"), { bindingJson: JSON.stringify(meter) }),
  ).rejects.toThrow(/refund/i);
  await t.mutation(ref("freezePurchase"), {
    key: (
      await t.mutation(ref("preparePurchase"), {
        inputJson: JSON.stringify(purchase),
      })
    ).key,
    paymentIntentId: "pi_topup1",
    reason: "payment_refunded",
    refundedAmount: 20,
  });
  await t.mutation(ref("closeAccount"), { bindingJson: JSON.stringify(meter) });
  await expect(
    t.mutation(ref("preparePurchase"), {
      inputJson: JSON.stringify({ ...purchase, purchaseId: "afterclose" }),
    }),
  ).rejects.toThrow(/reconciliation|closed/i);
});

it("counts locally consumed but unfinalized native grants before accepting another purchase", async () => {
  const { t, purchase } = await setupCredits();
  await t.run(async (ctx) => {
    const grant = (await ctx.db.query("usageCreditGrants").first())!;
    const { _id, _creationTime, ...fields } = grant;
    await ctx.db.patch("usageCreditGrants", _id, {
      available: "0",
      reserved: "0",
      consumed: "10",
    });
    for (let index = 1; index < 100; index++)
      await ctx.db.insert("usageCreditGrants", {
        ...fields,
        purchaseKey: "capacity" + index,
        creditGrantId: "credgr_capacity" + index,
        available: "0",
        reserved: "0",
        consumed: "10",
      });
  });
  await expect(
    t.mutation(ref("preparePurchase"), {
      inputJson: JSON.stringify({ ...purchase, purchaseId: "over-native-cap" }),
    }),
  ).rejects.toThrow(/capacity|quota/i);
});

it("allocates by provider creation time when native grants are mirrored out of order", async () => {
  const { t, purchase, event, subscription } = await setupCredits();
  const row = await t.mutation(ref("preparePurchase"), {
    inputJson: JSON.stringify({ ...purchase, purchaseId: "older-native" }),
  });
  const proof = {
    paymentIntentId: "pi_older",
    chargeId: "ch_older",
    amount: 20,
    currency: "usd",
    customerAccount: "acct_buyer",
    livemode: false,
  };
  await t.mutation(ref("pinPayment"), {
    key: row.key,
    paymentIntentId: proof.paymentIntentId,
  });
  await t.mutation(ref("verifyPayment"), {
    key: row.key,
    proofJson: JSON.stringify(proof),
  });
  await t.mutation(ref("pinGrant"), {
    key: row.key,
    proofJson: JSON.stringify({
      ...proof,
      creditGrantId: "credgr_older",
      stripePriceId: "price_calls",
      createdAt: 690,
      effectiveAt: 700,
      expiresAt: null,
    }),
  });
  const reservation = await t.mutation(ref("reserve"), {
    inputJson: JSON.stringify(event),
    subscriptionJson: JSON.stringify(subscription),
  });
  const grants = await t.run((ctx) =>
    ctx.db.query("usageCreditGrants").take(10),
  );
  expect(grants.find((g) => g.creditGrantId === "credgr_older")?.reserved).toBe(
    "6",
  );
  expect(
    grants.find((g) => g.creditGrantId === "credgr_topup1")?.reserved,
  ).toBe("0");
  expect(reservation.state).toBe("reserved");
});

it("does not replace credit backing with conflicting same-time evidence or resume through that ambiguity", async () => {
  const { t, purchase, meter } = await setupCredits();
  const proof = {
    creditGrantId: "credgr_topup1",
    paymentIntentId: "pi_topup1",
    currency: "usd",
    ledgerAmount: 8,
    availableAmount: 8,
    granted: 20,
    applied: 12,
    expired: 0,
    voided: 0,
    reinstated: 0,
    invoicesVerified: true,
    complete: true,
    transactions: [],
  };
  const saveProof = (value: typeof proof, startedAt = Date.now()) =>
    t.mutation(ref("saveObservation"), {
      inputJson: JSON.stringify(purchase),
      proofJson: JSON.stringify(value),
      startedAt,
    });
  await saveProof(proof);
  const result = JSON.parse(
    await saveProof({
      ...proof,
      ledgerAmount: 20,
      availableAmount: 20,
      applied: 0,
    }),
  );
  expect(result.backing).toBe("held");
  const grant = await t.run((ctx) => ctx.db.query("usageCreditGrants").first());
  expect(JSON.parse(grant!.nativeObservationJson!).ledgerAmount).toBe(8);
  await expect(
    t.mutation(ref("resumeAccount"), { bindingJson: JSON.stringify(meter) }),
  ).rejects.toThrow(/reconciliation|ambigu|funding/i);
});

it("keeps later credit history and grant cursors inside the requested original tenant binding", async () => {
  const { t, meter } = await setupCredits();
  const seed = async (binding: typeof meter, suffix: string) => {
    const row = await t.mutation(ref("preparePurchase"), {
      inputJson: JSON.stringify({
        ...binding,
        purchaseId: suffix,
        quantity: "10",
        ownership: "issuer",
        rollover: "retain_original_terms",
      }),
    });
    await t.mutation(ref("pinPayment"), {
      key: row.key,
      paymentIntentId: `pi_${suffix}`,
    });
    const proof = {
      paymentIntentId: `pi_${suffix}`,
      chargeId: `ch_${suffix}`,
      amount: 20,
      currency: "usd",
      customerAccount: binding.scope.customerAccount,
      livemode: false,
    };
    await t.mutation(ref("verifyPayment"), {
      key: row.key,
      proofJson: JSON.stringify(proof),
    });
    await t.mutation(ref("pinGrant"), {
      key: row.key,
      proofJson: JSON.stringify({
        ...proof,
        creditGrantId: `credgr_${suffix}`,
        stripePriceId: binding.binding.stripePriceId,
        createdAt: 700,
        effectiveAt: 700,
        expiresAt: null,
      }),
    });
    return row;
  };
  const original = await seed(meter, "topup2");
  const foreign = {
    ...meter,
    scope: { ...meter.scope, customerAccount: "acct_other" },
    binding: { ...meter.binding, stripeCustomerId: "cus_other" },
  };
  const intent = await t.mutation(prepare, {
    termsJson: JSON.stringify({ ...request, meters: [foreign] }),
    method: "direct",
  });
  const native = nativeSubscription();
  native.id = "sub_other";
  native.customer = "cus_other";
  native.customer_account = "acct_other";
  await t.mutation(save, {
    key: intent.key,
    nativeJson: JSON.stringify(native),
    startedAt: Date.now(),
  });
  const other = await seed(foreign, "other1");
  for (const name of ["readHistory", "readGrants"]) {
    const query = makeFunctionReference<"query">(
      `usageCredits/queries:${name}`,
    );
    const args = {
      bindingJson: JSON.stringify(meter),
      paginationOpts: { numItems: 1, cursor: null },
    };
    const first = await t.query(query, args);
    expect(first.isDone).toBe(false);
    const next = {
      ...args,
      paginationOpts: { numItems: 1, cursor: first.continueCursor },
    };
    expect(await t.query(query, next)).toEqual(await t.query(query, next));
    try {
      const page = await t.query(query, {
        ...next,
        bindingJson: JSON.stringify(foreign),
      });
      expect(
        page.page.every(
          (row: { accountKey: string }) =>
            row.accountKey === other.accountKey &&
            row.accountKey !== original.accountKey,
        ),
      ).toBe(true);
    } catch (error) {
      expect(String(error)).toMatch(/cursor|range|index|position|pagination/i);
    }
  }
});

it("retains open credit liabilities when a dispute freezes a fully consumed grant after a zero-balance observation", async () => {
  const { t, meter, purchase, row, event, subscription } = await setupCredits();
  const args = {
    inputJson: JSON.stringify({ ...event, quantity: "10" }),
    subscriptionJson: JSON.stringify(subscription),
  };
  const reserved = await t.mutation(ref("reserve"), args);
  await t.mutation(record, { ...args, reservationId: reserved.reservationId });
  await t.mutation(ref("saveObservation"), {
    inputJson: JSON.stringify(purchase),
    startedAt: Date.now(),
    proofJson: JSON.stringify({
      creditGrantId: "credgr_topup1",
      paymentIntentId: "pi_topup1",
      currency: "usd",
      ledgerAmount: 0,
      availableAmount: 0,
      granted: 20,
      applied: 20,
      expired: 0,
      voided: 0,
      reinstated: 0,
      invoicesVerified: true,
      complete: true,
      transactions: [],
    }),
  });
  await t.mutation(ref("freezePurchase"), {
    key: row.key,
    paymentIntentId: "pi_topup1",
    reason: "payment_disputed",
  });
  await expect(
    t.mutation(ref("closeAccount"), { bindingJson: JSON.stringify(meter) }),
  ).rejects.toThrow(/dispute|recovery|reconcil/i);
  expect(
    await t.run((ctx) => ctx.db.query("usageCreditAccounts").first()),
  ).toMatchObject({ closed: false, frozenReason: "payment_disputed" });
});
