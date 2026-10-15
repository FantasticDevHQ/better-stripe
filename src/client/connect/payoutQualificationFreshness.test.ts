// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { makeFunctionReference } from "convex/server";
import { setup, scope, component } from "./payoutExecutionTestHelpers.js";
import { previewRecipientPayout } from "./payoutPreview.js";
import { collectPayoutQualification } from "./payoutQualification.js";
afterEach(() => vi.restoreAllMocks());
async function delayedHistory(amounts?: number[]) {
  const s = await setup(amounts);
  const initial = Date.now();
  let now = initial;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const list = s.provider.balanceTransactions.list.getMockImplementation()!;
  let change: (() => void) | undefined;
  let delayed = false;
  s.provider.balanceTransactions.list.mockImplementation(async (params) => {
    if (!params.source && !delayed) {
      delayed = true;
      now += 35000;
      change?.();
    }
    const result = await list(params);
    const currency = (params as { currency?: string }).currency;
    return {
      ...result,
      data: currency
        ? result.data.filter((t) => t.currency === currency)
        : result.data,
    };
  });
  const preview = () =>
    previewRecipientPayout(
      s.provider as unknown as Stripe,
      component,
      s.ctx,
      scope,
      s.verify,
    );
  return { ...s, initial, preview, change: (fn: () => void) => (change = fn) };
}
it.each(["preview", "release"])(
  "a complete fresh history renews old source verification for %s",
  async (mode) => {
    const s = await delayedHistory();
    expect(await (mode === "preview" ? s.preview() : s.run())).toMatchObject(
      mode === "preview"
        ? { status: "qualified", amount: 1000, observedAt: s.initial + 35000 }
        : { status: "updated", claim: { status: "paid", amount: 1000 } },
    );
    expect(s.provider.payouts.create).toHaveBeenCalledTimes(
      mode === "preview" ? 0 : 1,
    );
  },
);
it.each(["changed", "matured", "missing", "partial"])(
  "does not renew source verification from %s provider history",
  async (kind) => {
    const s = await delayedHistory();
    if (kind === "matured")
      s.setTransactions(
        s
          .transactions()
          .map((t, i) => (i === 0 ? { ...t, status: "pending" } : t)),
      );
    s.change(() => {
      const rows = s.transactions();
      s.setTransactions(
        kind === "missing" || kind === "partial"
          ? rows.slice(1)
          : rows.map((t, i) =>
              i === 0
                ? kind === "matured"
                  ? { ...t, status: "available" }
                  : { ...t, fee: 1, net: t.amount - 1 }
                : t,
            ),
      );
    });
    if (kind === "partial") {
      const list = s.provider.balanceTransactions.list.getMockImplementation()!;
      s.provider.balanceTransactions.list.mockImplementation(
        async (params) => ({
          ...(await list(params)),
          has_more: !params.source,
        }),
      );
    }
    expect(await s.preview()).toMatchObject({ status: "held", amount: 0 });
    expect(s.provider.payouts.create).not.toHaveBeenCalled();
    expect(
      await s.t.run((ctx) => ctx.db.query("payoutReleaseClaims").collect()),
    ).toEqual([]);
  },
);
it("renews only the selected currency and leaves other source proof times unchanged", async () => {
  const s = await delayedHistory([600, 400, 100]);
  await s.t.run(async (ctx) => {
    const row = await ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) =>
        q.eq("stripeTransferId", "tr_2"),
      )
      .unique();
    await ctx.db.patch(row!._id, { currency: "eur" });
  });
  s.setTransactions(
    s.transactions().map((t, i) => (i === 2 ? { ...t, currency: "eur" } : t)),
  );
  const transfer = s.provider.transfers.retrieve.getMockImplementation()!;
  s.provider.transfers.retrieve.mockImplementation(async (id) => ({
    ...(await transfer(id)),
    currency: id.endsWith("_2") ? "eur" : "usd",
  }));
  const charge = s.provider.charges.retrieve.getMockImplementation()!;
  s.provider.charges.retrieve.mockImplementation(async (id) => ({
    ...(await charge(id)),
    currency: id.endsWith("_2") ? "eur" : "usd",
  }));
  s.provider.balance.retrieve.mockResolvedValue({
    available: [
      { currency: "usd", amount: 1000, source_types: { card: 1000 } },
      { currency: "eur", amount: 100, source_types: { card: 100 } },
    ],
    pending: [],
  });
  const proof = await collectPayoutQualification(
    s.provider as unknown as Stripe,
    component,
    s.ctx,
    scope,
    10,
  );
  expect(proof).toMatchObject({
    status: "verified",
    observations: [
      { currency: "usd", observedAt: s.initial + 35000 },
      { currency: "usd", observedAt: s.initial + 35000 },
      { currency: "eur", observedAt: s.initial },
    ],
  });
  if (proof.status !== "verified") throw new Error("Expected complete proof");
  const args = {
    accountId: scope.accountId,
    ownerKey: scope.ownerKey,
    currency: "usd",
    expectedRevision: 0,
    observations: proof.observations,
    providerAvailable: proof.providerAvailable,
    independentLiabilities: 0,
  };
  // Use the already-collected proof, whose EUR observation really is stale.
  expect(
    await s.t.query(
      makeFunctionReference<"query">("payoutRelease/queries:preview"),
      args,
    ),
  ).toMatchObject({
    status: "qualified",
    amount: 1000,
    observedAt: s.initial + 35000,
  });
  const claim = await s.t.mutation(
    makeFunctionReference<"mutation">("payoutRelease/mutations:claim"),
    { ...args, operationKey: scope.operationKey, destinationId: "ba_one" },
  );
  expect(claim).toMatchObject({ status: "reserved", amount: 1000 });
  expect(
    await s.t.mutation(
      makeFunctionReference<"mutation">("payoutRelease/mutations:beginAttempt"),
      {
        accountId: scope.accountId,
        ownerKey: scope.ownerKey,
        operationKey: scope.operationKey,
      },
    ),
  ).toMatchObject({ amount: 1000, attemptedAt: s.initial + 35000 });
});

it("still rejects local source changes after provider-history renewal", async () => {
  const s = await delayedHistory();
  const policy = await s.verify();
  s.verify.mockResolvedValueOnce(policy).mockImplementationOnce(async () => {
    await s.t.run(async (ctx) => {
      const row = await ctx.db.query("transfers").first();
      await ctx.db.patch(row!._id, { reversedAmount: 1 });
    });
    return policy;
  });
  await expect(s.preview()).rejects.toThrow(/snapshot changed/);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
