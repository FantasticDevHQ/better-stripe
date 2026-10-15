// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
import {
  payoutFixture,
  observationRef,
} from "./payoutReconciliationTestHelpers.js";
afterEach(() => vi.restoreAllMocks());
it("uses current provider state instead of a signed older pending body and deduplicates replay", async () => {
  const f = payoutFixture();
  const observed: string[] = [];
  const config = {
    onEvent: async () => {
      observed.push((await f.row())!.status);
    },
  };
  expect((await f.deliver(config)).status).toBe(200);
  expect(await f.row()).toMatchObject({
    status: "paid",
    accountId: "acct_recipient",
  });
  expect(observed).toEqual(["paid"]);
  expect(f.retrieve).toHaveBeenCalledWith(
    "po_current",
    {},
    { stripeAccount: "acct_recipient" },
  );
  expect(await f.deliver(config)).toMatchObject({
    status: 200,
    body: { deduplicated: true },
  });
  expect(f.retrieve).toHaveBeenCalledTimes(1);
  expect(observed).toEqual(["paid"]);
});
it("holds unavailable provider state without applying the signed body or calling application hooks", async () => {
  const f = payoutFixture();
  const onEvent = vi.fn();
  f.retrieve.mockRejectedValueOnce(new Error("Provider unavailable"));
  expect((await f.deliver({ onEvent })).status).toBe(500);
  expect(await f.row()).toBeNull();
  expect(onEvent).not.toHaveBeenCalled();
  expect(await f.ledger()).toMatchObject({ status: "failed" });
  expect((await f.deliver({ onEvent })).status).toBe(200);
  expect(await f.row()).toMatchObject({ status: "paid" });
});

it("commits synchronized callbacks with the accepted generation and rolls back callback failures", async () => {
  let canCommit = false;
  const f = payoutFixture({
    payout: {
      onCreate: async (ctx, doc) => {
        await ctx.runMutation(observationRef, { status: doc.status });
        if (!canCommit) throw new Error("Callback failed");
      },
      onUpdate: async (ctx, doc, old) => {
        await ctx.runMutation(observationRef, {
          status: doc.status,
          oldStatus: old.status,
        });
      },
    },
  });
  expect((await f.deliver()).status).toBe(500);
  expect(await f.row()).toBeNull();
  expect(
    await f.t.run((ctx) => ctx.db.query("observations").collect()),
  ).toEqual([]);
  canCommit = true;
  expect((await f.deliver()).status).toBe(200);
  expect(await f.row()).toMatchObject({ status: "paid" });
  expect(
    await f.t.run((ctx) => ctx.db.query("observations").collect()),
  ).toHaveLength(1);
  f.event.id = "evt_same_current";
  expect((await f.deliver()).status).toBe(200);
  expect(
    await f.t.run((ctx) => ctx.db.query("observations").collect()),
  ).toHaveLength(1);
  f.set({
    status: "failed",
    failure_code: "account_closed",
    failure_message: "Closed",
  });
  f.event.id = "evt_later_failure";
  expect((await f.deliver()).status).toBe(200);
  expect(await f.row()).toMatchObject({
    status: "failed",
    failureCode: "account_closed",
  });
  expect(
    await f.t.run((ctx) => ctx.db.query("observations").collect()),
  ).toMatchObject([
    { status: "paid" },
    { status: "failed", oldStatus: "paid" },
  ]);
});

it("prevents a delayed old provider response from repeating or regressing a synchronized callback", async () => {
  const f = payoutFixture({
    payout: {
      onCreate: async (ctx, doc) => {
        await ctx.runMutation(observationRef, { status: doc.status });
      },
      onUpdate: async (ctx, doc, old) => {
        await ctx.runMutation(observationRef, {
          status: doc.status,
          oldStatus: old.status,
        });
      },
    },
  });
  let resolve!: (value: ReturnType<typeof f.current>) => void;
  const response = new Promise<ReturnType<typeof f.current>>((done) => {
    resolve = done;
  });
  f.retrieve.mockImplementationOnce(async () => (await response) as never);
  const old = { ...f.current(), status: "pending" as const };
  const first = f.deliver();
  await vi.waitFor(() => expect(f.retrieve).toHaveBeenCalledTimes(1));
  f.event.id = "evt_concurrent_newer";
  expect((await f.deliver()).status).toBe(200);
  resolve(old);
  expect((await first).status).toBe(200);
  expect(await f.row()).toMatchObject({ status: "paid" });
  expect(
    await f.t.run((ctx) => ctx.db.query("observations").collect()),
  ).toMatchObject([{ status: "paid" }]);
});
it("preserves an accepted row when a later provider read fails", async () => {
  const f = payoutFixture();
  await f.deliver();
  const original = await f.row();
  f.event.id = "evt_provider_unavailable_later";
  f.retrieve.mockRejectedValueOnce(new Error("Provider unavailable"));
  expect((await f.deliver()).status).toBe(500);
  expect(await f.row()).toEqual(original);
  expect((await f.deliver()).status).toBe(200);
  expect(await f.row()).toEqual(original);
});
it("uses explicit platform scope without adopting metadata or bank account IDs", async () => {
  const f = payoutFixture();
  f.event.account = undefined;
  expect((await f.deliver()).status).toBe(200);
  expect(await f.row()).toMatchObject({
    accountId: "platform",
    status: "paid",
  });
  expect(f.retrieve).toHaveBeenCalledWith("po_current", {}, {});
});
it("rejects a foreign signed account for an existing payout before any provider read or callback", async () => {
  const f = payoutFixture();
  await f.deliver();
  const original = await f.row();
  f.event.id = "evt_foreign_account";
  f.event.account = "acct_foreign";
  const onEvent = vi.fn();
  expect((await f.deliver({ onEvent })).status).toBe(500);
  expect(await f.row()).toEqual(original);
  expect(f.retrieve).toHaveBeenCalledTimes(1);
  expect(onEvent).not.toHaveBeenCalled();
});
it("rejects a provider response for a different payout without adopting it", async () => {
  const f = payoutFixture();
  f.set({ id: "po_foreign" });
  const onEvent = vi.fn();
  expect((await f.deliver({ onEvent })).status).toBe(500);
  expect(await f.row()).toBeNull();
  expect(onEvent).not.toHaveBeenCalled();
});
