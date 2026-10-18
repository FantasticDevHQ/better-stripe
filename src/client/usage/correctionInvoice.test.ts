import { afterEach, expect, it, vi } from "vitest";
import type { RunCtx } from "../helpers.js";
import { setupCorrection } from "./correctionTransport.fixtures.js";
afterEach(() => vi.useRealTimers());
async function partial() {
  const f = await setupCorrection();
  await f.f.t.action((ctx) =>
    f.client.usage.requestCorrection(
      ctx as RunCtx,
      { ...f.correction, quantity: "2" },
      f.options,
    ),
  );
  const input = {
    scope: f.correction.scope,
    eventId: f.correction.eventId,
    correctionId: f.correction.correctionId,
    invoiceId: "in_usage",
    creditNoteId: "cn_fix",
    amount: 4,
  };
  return { ...f, input };
}
it("verifies the original paid invoice, invoice payment, charge and succeeded refund before recording cash adjustment provenance", async () => {
  const { f, client, options, state, input } = await partial();
  state.paidAdjustment = true;
  expect(
    await f.t.action((ctx) =>
      client.usage.observeInvoiceCorrection(ctx as RunCtx, input, options),
    ),
  ).toMatchObject({
    state: "confirmed",
    creditNoteId: "cn_fix",
    refundId: "re_fix",
    restoredQuantity: "0",
    resolution: "invoice_credit",
    cashCollection: "none",
    invoiceAdjustment: {
      amount: 4,
      currency: "usd",
      postPaymentAmount: 4,
      paymentIntentId: "pi_invoice",
      chargeId: "ch_invoice",
      refundId: "re_fix",
    },
  });
});
it("holds foreign, incomplete, pending-refund and wrong-line native credit evidence", async () => {
  for (const invalid of [
    "foreignNote",
    "truncatedNote",
    "foreignLine",
    "pendingRefund",
  ] as const) {
    const { f, client, options, state, input } = await partial();
    if (invalid === "pendingRefund") {
      state.paidAdjustment = true;
      state.refundSucceeded = false;
    } else state[invalid] = true;
    expect(
      await f.t.action((ctx) =>
        client.usage.observeInvoiceCorrection(ctx as RunCtx, input, options),
      ),
    ).toMatchObject({ status: "held" });
  }
});
it("does not claim the same native credit note for a second correction operation", async () => {
  const { f, client, options, correction, input } = await partial();
  await f.t.action((ctx) =>
    client.usage.observeInvoiceCorrection(ctx as RunCtx, input, options),
  );
  await f.t.action((ctx) =>
    client.usage.requestCorrection(
      ctx as RunCtx,
      { ...correction, correctionId: "fix2", quantity: "1" },
      options,
    ),
  );
  await expect(
    f.t.action((ctx) =>
      client.usage.observeInvoiceCorrection(
        ctx as RunCtx,
        { ...input, correctionId: "fix2" },
        options,
      ),
    ),
  ).rejects.toThrow(/already claimed/i);
});
it("records a verified pre-payment credit-note void without refunding cash or restoring valid usage", async () => {
  const { f, client, options, state, input } = await partial();
  await f.t.action((ctx) =>
    client.usage.observeInvoiceCorrection(ctx as RunCtx, input, options),
  );
  state.voidedNote = true;
  expect(
    await f.t.action((ctx) =>
      client.usage.observeInvoiceCorrection(ctx as RunCtx, input, options),
    ),
  ).toMatchObject({
    state: "confirmed",
    nativeCreditNoteStatus: "void",
    reason: "native_invoice_credit_voided",
    cashConsequence: "none",
    restoredQuantity: "0",
  });
});

it("rejects unsafe native payment and charge amounts instead of normalizing a refund proof", async () => {
  const { f, client, options, state, input } = await partial();
  state.paidAdjustment = true;
  state.invalidCash = true;
  expect(
    await f.t.action((ctx) =>
      client.usage.observeInvoiceCorrection(ctx as RunCtx, input, options),
    ),
  ).toMatchObject({ status: "held" });
});

it("does not treat missing native tax and page evidence as a known empty financial history", async () => {
  const { f, client, options, state, input } = await partial();
  state.missingEvidence = true;
  expect(
    await f.t.action((ctx) =>
      client.usage.observeInvoiceCorrection(ctx as RunCtx, input, options),
    ),
  ).toMatchObject({ status: "held" });
});
