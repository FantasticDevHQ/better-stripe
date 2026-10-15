// @vitest-environment edge-runtime
import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { makeFunctionReference } from "convex/server";
import type { RunCtx } from "../helpers.js";
import {
  component,
  setup,
  operation,
  type Scope,
} from "./payoutSyncTestHelpers.js";
const symbol = Symbol.for("toReferencePath");
it("persists the current automatic payout under the connected scope without requiring mature funding", async () => {
  const s = await setup();
  expect(await s.run()).toMatchObject({ status: "accepted", changed: true });
  expect(s.retrieve).toHaveBeenCalledWith(
    "po_one",
    {},
    { stripeAccount: "acct_owner" },
  );
  expect(await s.row()).toMatchObject({
    stripePayoutId: "po_one",
    accountId: "acct_owner",
    amount: 500,
    currency: "jpy",
    status: "paid",
    arrivalDate: "1970-01-01T00:03:20.000Z",
  });
  expect(await s.run()).toMatchObject({ status: "accepted", changed: false });
  expect(
    await s.t.run((ctx) => ctx.db.query("payouts").collect()),
  ).toHaveLength(1);
  expect(
    await s.t.run((ctx) => ctx.db.query("currencyTotals").unique()),
  ).toMatchObject({
    accountId: "acct_owner",
    currency: "jpy",
    paidOut: 500,
    count: 1,
  });
});
it("allows a later authoritative paid-to-failed transition and clears obsolete failure details", async () => {
  const s = await setup();
  await s.run();
  s.set({
    status: "failed",
    failure_code: "account_closed",
    failure_message: "Bank account closed",
  });
  await s.run();
  expect(await s.row()).toMatchObject({
    status: "failed",
    failureCode: "account_closed",
  });
  expect(
    await s.t.run((ctx) => ctx.db.query("currencyTotals").unique()),
  ).toMatchObject({ paidOut: 0, count: 1 });
  s.set({ status: "pending", failure_code: null, failure_message: null });
  await s.run();
  expect((await s.row())?.failureCode).toBeUndefined();
  expect((await s.row())?.failureMessage).toBeUndefined();
});
it("keeps platform scope explicit and ignores provider metadata as account authority", async () => {
  const s = await setup({ type: "platform" });
  s.set({ automatic: false });
  await s.run();
  expect(s.retrieve).toHaveBeenCalledWith("po_one", {}, {});
  expect(await s.row()).toMatchObject({
    accountId: "platform",
    currency: "jpy",
  });
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("supersedes a delayed old pending read after a newer paid observation commits", async () => {
  const s = await setup();
  const old = { ...s.read(), status: "pending" as const };
  const response = deferred<Stripe.Payout>();
  s.retrieve.mockImplementationOnce(() => response.promise);
  const first = s.run();
  await vi.waitFor(() => expect(s.retrieve).toHaveBeenCalledTimes(1));
  expect(await s.run()).toMatchObject({ status: "accepted", generation: 2 });
  response.resolve(old);
  expect(await first).toMatchObject({ status: "superseded", generation: 1 });
  expect(await s.row()).toMatchObject({ status: "paid" });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSyncClaims").unique()),
  ).toMatchObject({ status: "accepted", generation: 2, acceptedGeneration: 2 });
});
it("a newer failed read holds its generation instead of accepting an older in-flight snapshot", async () => {
  const s = await setup();
  await s.run();
  const response = deferred<Stripe.Payout>();
  s.retrieve.mockImplementationOnce(() => response.promise);
  const first = s.run();
  await vi.waitFor(() => expect(s.retrieve).toHaveBeenCalledTimes(2));
  s.retrieve.mockRejectedValueOnce(new Error("Provider unavailable"));
  await expect(s.run()).rejects.toThrow("Provider unavailable");
  response.resolve({ ...s.read(), status: "pending" });
  expect(await first).toMatchObject({ status: "superseded" });
  expect(await s.row()).toMatchObject({ status: "paid" });
  expect(
    await s.t.run((ctx) => ctx.db.query("payoutSyncClaims").unique()),
  ).toMatchObject({ status: "unknown", generation: 3, acceptedGeneration: 1 });
  expect(await s.run()).toMatchObject({
    status: "accepted",
    generation: 4,
    changed: false,
  });
});
it.each(["begin", "finish"] as const)(
  "recovers a lost %s response through a fresh durable generation",
  async (stage) => {
    const s = await setup();
    let isLost = false;
    const ctx = {
      ...s.ctx,
      runMutation: async (ref: Record<symbol, string>, args: never) => {
        const saved = await s.mutate(ref, args);
        if (!isLost && ref[symbol].endsWith(`/payoutSync/mutations/${stage}`)) {
          isLost = true;
          throw new Error("Lost component response");
        }
        return saved;
      },
    } as unknown as RunCtx;
    const sync = await operation();
    await expect(
      sync(s.provider, component, ctx, {
        stripePayoutId: "po_one",
        scope: s.scope,
      }),
    ).rejects.toThrow("Lost component response");
    expect(
      await s.t.run((ctx) => ctx.db.query("payoutSyncClaims").unique()),
    ).toMatchObject({
      generation: 1,
      status: stage === "finish" ? "accepted" : "pending",
    });
    expect(await s.run()).toMatchObject({
      status: "accepted",
      generation: 2,
      changed: stage === "begin",
    });
    expect(
      await s.t.run((ctx) => ctx.db.query("payouts").collect()),
    ).toHaveLength(1);
    expect(
      await s.t.run((ctx) => ctx.db.query("currencyTotals").unique()),
    ).toMatchObject({ paidOut: 500, count: 1 });
  },
);
it("rejects a foreign existing payout before requesting provider state", async () => {
  const s = await setup();
  await s.t.mutation(
    makeFunctionReference<"mutation">("connect/mutations:upsertPayout"),
    {
      stripePayoutId: "po_one",
      accountId: "acct_foreign",
      amount: 500,
      currency: "jpy",
      status: "paid",
    },
  );
  await expect(s.run()).rejects.toThrow(
    "Existing payout account does not match.",
  );
  expect(s.retrieve).not.toHaveBeenCalled();
  expect(await s.row()).toMatchObject({ accountId: "acct_foreign" });
});
it("rejects changing a payout's durable account even if no financial row was saved", async () => {
  const s = await setup();
  s.retrieve.mockRejectedValueOnce(new Error("Unavailable"));
  await expect(s.run()).rejects.toThrow("Unavailable");
  s.retrieve.mockClear();
  const sync = await operation();
  await expect(
    sync(s.provider, component, s.ctx, {
      stripePayoutId: "po_one",
      scope: { type: "connected", accountId: "acct_foreign" },
    }),
  ).rejects.toThrow("Payout synchronization account does not match.");
  expect(s.retrieve).not.toHaveBeenCalled();
  expect(await s.row()).toBeNull();
});
it.each([{ amount: 501 }, { currency: "kwd" }])(
  "rejects changed original money %j without changing summaries",
  async (patch) => {
    const s = await setup();
    await s.run();
    s.set(patch);
    await expect(s.run()).rejects.toThrow(
      "Existing payout original money does not match.",
    );
    expect(await s.row()).toMatchObject({ amount: 500, currency: "jpy" });
    expect(
      await s.t.run((ctx) => ctx.db.query("currencyTotals").unique()),
    ).toMatchObject({ paidOut: 500, count: 1 });
  },
);
it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN])(
  "rejects invalid provider amount %s without a financial record",
  async (amount) => {
    const s = await setup();
    s.set({ amount });
    await expect(s.run()).rejects.toThrow(
      "Invalid payout synchronization money or method.",
    );
    expect(await s.row()).toBeNull();
    expect(
      await s.t.run((ctx) => ctx.db.query("payoutSyncClaims").unique()),
    ).toMatchObject({ status: "unknown" });
  },
);
it("rejects an unavailable provider response and preserves retryability", async () => {
  const s = await setup();
  s.retrieve.mockResolvedValueOnce(null as unknown as Stripe.Payout);
  await expect(s.run()).rejects.toThrow(
    "Provider payout response is unavailable.",
  );
  expect(await s.row()).toBeNull();
  expect(await s.run()).toMatchObject({ status: "accepted", generation: 2 });
});
it("rejects a foreign provider payout ID", async () => {
  const s = await setup();
  s.set({ id: "po_foreign" });
  await expect(s.run()).rejects.toThrow(
    "Provider payout identity does not match.",
  );
  expect(await s.row()).toBeNull();
});
it.each([NaN, -1, 8640000000001])(
  "rejects invalid arrival seconds %s",
  async (arrival_date) => {
    const s = await setup();
    s.set({ arrival_date });
    await expect(s.run()).rejects.toThrow(
      "Invalid provider payout arrival date.",
    );
    expect(await s.row()).toBeNull();
  },
);
it.each(["jpy", "kwd"])(
  "preserves exact safe original %s units at the maximum integer",
  async (currency) => {
    const s = await setup();
    s.set({ currency, amount: Number.MAX_SAFE_INTEGER });
    await s.run();
    expect(await s.row()).toMatchObject({
      currency,
      amount: Number.MAX_SAFE_INTEGER,
    });
    expect(
      await s.t.run((ctx) => ctx.db.query("currencyTotals").unique()),
    ).toMatchObject({ currency, paidOut: Number.MAX_SAFE_INTEGER });
  },
);
it("does not reinterpret a connected account named platform as platform authority", async () => {
  const s = await setup({ type: "connected", accountId: "platform" });
  await expect(s.run()).rejects.toThrow(
    "Payout synchronization scope must be explicit.",
  );
  expect(s.retrieve).not.toHaveBeenCalled();
  expect(await s.row()).toBeNull();
});
it("deduplicates equivalent provider metadata order without a financial update", async () => {
  const s = await setup();
  s.set({ metadata: { b: "two", a: "one" } });
  await s.run();
  s.set({ metadata: { a: "one", b: "two" } });
  expect(await s.run()).toMatchObject({ status: "accepted", changed: false });
});
it("publishes authoritative synchronization through the actual BetterStripe client", async () => {
  const s = await setup();
  const { BetterStripe } = await import("../index.js");
  const spy = vi
    .spyOn(
      BetterStripe.prototype as unknown as { stripe: () => Stripe },
      "stripe",
    )
    .mockReturnValue(s.provider);
  try {
    const client = new BetterStripe(component) as InstanceType<
      typeof BetterStripe
    > & {
      syncPayoutFromStripe: (
        ctx: RunCtx,
        opts: { stripePayoutId: string; scope: Scope },
      ) => Promise<unknown>;
    };
    expect(
      client.syncPayoutFromStripe,
      "public authoritative payout method is missing",
    ).toBeTypeOf("function");
    expect(
      await client.syncPayoutFromStripe(s.ctx, {
        stripePayoutId: "po_one",
        scope: s.scope,
      }),
    ).toMatchObject({ status: "accepted" });
    expect(await s.row()).toMatchObject({
      accountId: "acct_owner",
      status: "paid",
    });
  } finally {
    spy.mockRestore();
  }
});
