import { afterEach, expect, it, vi } from "vitest";
import type { RunCtx } from "../helpers.js";
import { fixture } from "./creditSettlement.fixtures.js";
afterEach(() => vi.useRealTimers());
it("pays an issuer-service purchase affiliate once and never pays again for credit consumption", async () => {
  const f = await fixture(),
    { native, client, options, view, input, settle } = f;
  const first = await settle();
  expect(first).toMatchObject({
    status: "settled",
    gross: 20,
    processingFee: 1,
    platformNet: 18,
    creditSource: { purchaseId: "topup1", creditGrantId: "credgr_topup1" },
    transfers: [{ role: "affiliate", amount: 1 }],
  });
  const event = {
      scope: f.purchase.scope,
      binding: f.purchase.binding,
      sourceEventId: "consume1",
      quantity: "6",
      occurredAt: 700,
    },
    subscription = view.bindings[0].subscription;
  const reservation = await f.t.action((ctx) =>
    client.usage.reserveCredits(ctx as RunCtx, { event, subscription }),
  );
  await f.t.action((ctx) =>
    client.usage.record(ctx as RunCtx, {
      event,
      subscription,
      reservationId: reservation.reservationId,
    }),
  );
  expect(await settle()).toEqual(first);
  expect(native).toHaveLength(1);
  f.state.processingFee = 2;
  expect(await settle()).toMatchObject({
    status: "conflict",
    reason: "identity_changed",
  });
  expect(native).toHaveLength(1);
  f.state.processingFee = 1;
  f.state.refunded = true;
  expect(await settle()).toMatchObject({
    status: "rejected",
    reason: "payment_not_payable",
  });
  expect(native).toHaveLength(1);
  for (const unsupported of [
    {
      ...input,
      policy: { ...input.policy, creatorAccountId: "acct_reseller" },
    },
    { ...input, ownership: "reseller" },
  ])
    expect(
      await f.t.action((ctx) =>
        client.usage.settleCreditPurchase(
          ctx as RunCtx,
          unsupported as typeof input,
          options,
        ),
      ),
    ).toMatchObject({ status: "rejected", reason: "unsupported_source" });
});
