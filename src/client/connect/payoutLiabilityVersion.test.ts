// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import { makeFunctionReference } from "convex/server";
import { setup } from "./payoutExecutionTestHelpers.js";
it("invalidates a liability version when refund costs increase before the attempt", async () => {
  const s = await setup([600, 401]);
  const cost = {
    accountId: "acct_recipient",
    scopeKey: "store:owner",
    currency: "usd",
    claimKey: "refund:new",
    sourceChargeId: "ch_refunded",
    sourceGross: 1001,
    sourceProcessingFee: 2,
    amountDue: 1,
    revision: 1,
  };
  await s.t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:record"),
    cost,
  );
  const version = await s.t.run(
    async (ctx) =>
      (await ctx.db.query("payoutRiskRevisions").first())?.riskRevision ?? 0,
  );
  const verified = await s.verify();
  s.verify.mockResolvedValueOnce(verified).mockImplementationOnce(async () => {
    await s.t.mutation(
      makeFunctionReference<"mutation">("costRecovery/mutations:record"),
      { ...cost, amountDue: 2, revision: 2 },
    );
    return verified;
  });
  await expect(
    s.run({ independentLiabilities: 1, liabilityRevision: version }),
  ).rejects.toThrow(/liabilit|collection changed/);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});

it.each(["new", "increase", "decrease"])(
  "rejects %s recovery costs before attempt and pays only after a fresh quote",
  async (kind) => {
    const { CostRecoveryClient } = await import("../costRecovery.js");
    const { component } = await import("./payoutExecutionTestHelpers.js");
    const s = await setup([600, 405]);
    const client = new CostRecoveryClient(component);
    const cost = {
      accountId: "acct_recipient",
      scopeKey: "store:owner",
      currency: "usd",
      claimKey: "refund:new",
      sourceChargeId: "ch_refunded",
      sourceGross: 1005,
      sourceProcessingFee: 2,
      amountDue: kind === "new" ? 0 : kind === "increase" ? 1 : 2,
      revision: 1,
    };
    await s.t.mutation(
      makeFunctionReference<"mutation">("costRecovery/mutations:record"),
      cost,
    );
    const quote = await client.payoutQuote(s.ctx, cost);
    const changed = kind === "increase" ? 2 : 1;
    const verified = await s.verify();
    s.verify
      .mockResolvedValueOnce(verified)
      .mockImplementationOnce(async () => {
        await s.t.mutation(
          makeFunctionReference<"mutation">("costRecovery/mutations:record"),
          { ...cost, amountDue: changed, revision: 2 },
        );
        return verified;
      });
    await expect(s.run(quote)).rejects.toThrow(/collection changed/);
    expect(s.provider.payouts.create).not.toHaveBeenCalled();
    expect(await s.run(quote)).toMatchObject({
      status: "terminal",
      claim: { status: "canceled" },
    });
    const fresh = await client.payoutQuote(s.ctx, cost);
    expect(fresh.independentLiabilities).toBe(changed);
    expect(fresh.liabilityRevision).toBeGreaterThan(quote.liabilityRevision);
    expect(
      await s.run({ ...fresh, operationKey: "fresh-payout" }),
    ).toMatchObject({
      status: "updated",
      claim: {
        status: "paid",
        amount: 1005 - changed,
        liabilityRevision: fresh.liabilityRevision,
      },
    });
    expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  },
);
it("accepts unchanged atomic quotes and excludes costs from another currency", async () => {
  const { CostRecoveryClient } = await import("../costRecovery.js");
  const { component } = await import("./payoutExecutionTestHelpers.js");
  const s = await setup([600, 405]);
  const client = new CostRecoveryClient(component);
  const cost = {
    accountId: "acct_recipient",
    scopeKey: "store:owner",
    currency: "eur",
    claimKey: "refund:eur",
    sourceChargeId: "ch_refunded",
    sourceGross: 1005,
    sourceProcessingFee: 2,
    amountDue: 2,
    revision: 1,
  };
  await s.t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:record"),
    cost,
  );
  const quote = await client.payoutQuote(s.ctx, { ...cost, currency: "usd" });
  expect(quote.independentLiabilities).toBe(0);
  await s.t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:record"),
    cost,
  );
  expect(await client.payoutQuote(s.ctx, { ...cost, currency: "usd" })).toEqual(
    quote,
  );
  expect(await s.run(quote)).toMatchObject({
    status: "updated",
    claim: { status: "paid", amount: 1005, currency: "usd" },
  });
});
it("rejects a quote that is already stale before qualification", async () => {
  const { CostRecoveryClient } = await import("../costRecovery.js");
  const { component } = await import("./payoutExecutionTestHelpers.js");
  const s = await setup([600, 405]);
  const client = new CostRecoveryClient(component);
  const cost = {
    accountId: "acct_recipient",
    scopeKey: "store:owner",
    currency: "usd",
    claimKey: "refund:new",
    sourceChargeId: "ch_refunded",
    sourceGross: 1005,
    sourceProcessingFee: 2,
    amountDue: 1,
    revision: 1,
  };
  await s.t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:record"),
    cost,
  );
  const quote = await client.payoutQuote(s.ctx, cost);
  await s.t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:record"),
    { ...cost, amountDue: 2, revision: 2 },
  );
  await expect(s.run(quote)).rejects.toThrow(/liability version changed/);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
it("fails safely when a legacy unversioned caller gains recovery debt before attempt", async () => {
  const s = await setup();
  const verified = await s.verify();
  s.verify.mockResolvedValueOnce(verified).mockImplementationOnce(async () => {
    await s.t.mutation(
      makeFunctionReference<"mutation">("costRecovery/mutations:record"),
      {
        accountId: "acct_recipient",
        scopeKey: "store:owner",
        currency: "usd",
        claimKey: "refund:new",
        sourceChargeId: "ch_refunded",
        sourceGross: 1000,
        sourceProcessingFee: 1,
        amountDue: 1,
        revision: 1,
      },
    );
    return verified;
  });
  await expect(s.run()).rejects.toThrow(/versioned recovery liability quote/);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
});

it("protects a versioned quote across a larger paginated collection", async () => {
  const { CostRecoveryClient } = await import("../costRecovery.js");
  const { component } = await import("./payoutExecutionTestHelpers.js");
  const s = await setup(Array.from({ length: 205 }, () => 5));
  const client = new CostRecoveryClient(component);
  const cost = {
    accountId: "acct_recipient",
    scopeKey: "store:owner",
    currency: "usd",
    claimKey: "refund:new",
    sourceChargeId: "ch_refunded",
    sourceGross: 1025,
    sourceProcessingFee: 2,
    amountDue: 1,
    revision: 1,
  };
  await s.t.mutation(
    makeFunctionReference<"mutation">("costRecovery/mutations:record"),
    cost,
  );
  const quote = await client.payoutQuote(s.ctx, cost);
  const verified = await s.verify();
  s.verify.mockResolvedValueOnce(verified).mockImplementationOnce(async () => {
    await s.t.mutation(
      makeFunctionReference<"mutation">("costRecovery/mutations:record"),
      { ...cost, amountDue: 2, revision: 2 },
    );
    return verified;
  });
  await expect(s.run(quote)).rejects.toThrow(/collection changed/);
  expect(s.provider.payouts.create).not.toHaveBeenCalled();
  await s.run(quote);
  const fresh = await client.payoutQuote(s.ctx, cost);
  expect(await s.run({ ...fresh, operationKey: "fresh-large" })).toMatchObject({
    status: "updated",
    claim: { status: "paid", amount: 1023, independentLiabilities: 2 },
  });
  expect(s.provider.payouts.create).toHaveBeenCalledTimes(1);
  // This new integration case qualifies the full ledger twice, with a cancellation between.
}, 15_000);
