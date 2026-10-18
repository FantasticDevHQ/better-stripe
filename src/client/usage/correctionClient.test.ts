import { afterEach, expect, it, vi } from "vitest";
import type { RunCtx } from "../helpers.js";
import { setupCorrection } from "./correctionTransport.fixtures.js";
afterEach(() => vi.useRealTimers());
it("uses the original native identifier and stable operation key without claiming pending cancellation complete", async () => {
  const { f, client, options, correction, receipt, calls } =
    await setupCorrection();
  const result = await f.t.action((ctx) =>
    client.usage.requestCorrection(ctx as RunCtx, correction, options),
  );
  expect(result).toMatchObject({
    state: "provider_accepted",
    nativeStatus: "pending",
    nativeAdjustmentId: null,
    restoredQuantity: "0",
    cashConsequence: "none",
  });
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toEqual(result);
  expect(calls).toHaveLength(1);
  expect(calls[0].body.get("cancel[identifier]")).toBe(
    `bs_usage_${receipt.eventId}`,
  );
  expect(calls[0].key).toMatch(/^bs_usage_correction_/);
});

it("retains units if an invoice finalizes while the native cancellation is processing", async () => {
  const { f, client, options, correction, state } = await setupCorrection();
  state.status = "complete";
  state.finalizeOnAdjust = true;
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({
    state: "invoice_adjustment_required",
    nativeStatus: "complete",
    invoiceId: "in_usage",
    restoredQuantity: "0",
    cashConsequence: "operator_resolution_required",
  });
});

it("exposes bounded correction evidence beside original usage and preserves unknown legacy coverage", async () => {
  const { f, client, options, correction, original } = await setupCorrection();
  const before = await f.t.query((ctx) =>
    client.usage.readCorrectionHistory(ctx as RunCtx, {
      scope: correction.scope,
      eventId: correction.eventId,
      limit: 1,
      cursor: null,
    }),
  );
  expect(before).toMatchObject({ records: [], coverage: "not_recorded" });
  await f.t.action((ctx) =>
    client.usage.requestCorrection(ctx as RunCtx, correction, options),
  );
  const page = await f.t.query((ctx) =>
    client.usage.readCorrectionHistory(ctx as RunCtx, {
      scope: correction.scope,
      eventId: correction.eventId,
      limit: 1,
      cursor: null,
    }),
  );
  expect(page.records).toHaveLength(1);
  expect(page.isDone).toBe(false);
  expect(page.coverage).toBe("recorded");
  const status = await f.t.query((ctx) =>
    client.usage.getReconciliation(ctx as RunCtx, {
      scope: original.scope,
      binding: original.binding,
      subscription: original.subscription,
      period: original.subscription.period,
    }),
  );
  expect(status.correctionHistory).toMatchObject({
    status: "available",
    value: { coverage: "recorded" },
  });
});

it("adopts a verified partial native invoice credit without erasing valid usage or issuing another refund", async () => {
  const { f, client, options, correction } = await setupCorrection();
  const partial = { ...correction, quantity: "2" };
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, partial, options),
    ),
  ).toMatchObject({ state: "unsupported", restoredQuantity: "0" });
  const input = {
    scope: correction.scope,
    eventId: correction.eventId,
    correctionId: correction.correctionId,
    invoiceId: "in_usage",
    creditNoteId: "cn_fix",
    amount: 4,
  };
  const adopted = await f.t.action((ctx) =>
    client.usage.observeInvoiceCorrection(ctx as RunCtx, input, options),
  );
  expect(adopted).toMatchObject({
    state: "confirmed",
    resolution: "invoice_credit",
    creditNoteId: "cn_fix",
    restoredQuantity: "0",
    cashConsequence: "verified_external_adjustment",
  });
  expect(
    await f.t.action((ctx) =>
      client.usage.observeInvoiceCorrection(ctx as RunCtx, input, options),
    ),
  ).toEqual(adopted);
  expect(
    (
      await f.t.query((ctx) =>
        client.usage.getDelivery(ctx as RunCtx, {
          scope: correction.scope,
          eventId: correction.eventId,
        }),
      )
    ).state,
  ).toBe("provider_accepted");
});

it("restores included units once after complete native cancellation and reconciles the retained original ledger", async () => {
  const { f, client, options, correction, original, state } =
    await setupCorrection(true);
  state.status = "complete";
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({ state: "confirmed", restoredQuantity: "6" });
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({ restoredQuantity: "6" });
  expect(
    await f.t.query((ctx) =>
      client.usage.getAllowanceStatus(ctx as RunCtx, original),
    ),
  ).toMatchObject({ consumedQuantity: "0", remainingIncludedQuantity: "10" });
  expect(
    await f.t.query((ctx) =>
      client.usage.reconcileAllowance(ctx as RunCtx, original),
    ),
  ).toMatchObject({ status: "matched", acceptedScaledQuantity: "0" });
});
