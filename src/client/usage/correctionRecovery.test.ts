import { afterEach, expect, it, vi } from "vitest";
import type { RunCtx } from "../helpers.js";
import { setupCorrection } from "./correctionTransport.fixtures.js";
afterEach(() => vi.useRealTimers());
it("retains unknown native outcomes and retries the same operation identity without leaking provider error bodies", async () => {
  const { f, client, options, correction, state, calls } =
    await setupCorrection();
  state.failFirstAdjustment = true;
  const unknown = await f.t.action((ctx) =>
    client.usage.requestCorrection(ctx as RunCtx, correction, options),
  );
  expect(unknown).toMatchObject({
    state: "held",
    reason: "provider_outcome_unknown",
    restoredQuantity: "0",
  });
  expect(JSON.stringify(unknown)).not.toContain("sk_test_private");
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({ state: "provider_accepted", nativeStatus: "pending" });
  expect(calls).toHaveLength(2);
  expect(calls[0].key).toBe(calls[1].key);
  expect(calls[0].body.toString()).toBe(calls[1].body.toString());
});
it("recovers provider success followed by receipt-storage failure with the same native key after the lease", async () => {
  const { f, client, options, correction, calls } = await setupCorrection(
    false,
    100000,
  );
  let failed = false;
  await expect(
    f.t.action((ctx) =>
      client.usage.requestCorrection(
        {
          ...ctx,
          runMutation: async (ref, ...args) => {
            if (
              !failed &&
              String(
                ref[Symbol.for("toReferencePath") as keyof typeof ref],
              ).endsWith("/usageCorrections/mutations/save")
            ) {
              failed = true;
              throw new Error("Receipt storage unavailable");
            }
            return ctx.runMutation(ref, ...args);
          },
        } as RunCtx,
        correction,
        options,
      ),
    ),
  ).rejects.toThrow(/receipt storage/i);
  vi.advanceTimersByTime(901000);
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({ state: "provider_accepted", restoredQuantity: "0" });
  expect(calls).toHaveLength(2);
  expect(calls[0].key).toBe(calls[1].key);
});
it("requires invoice adjustment outside the conservative native cancellation window", async () => {
  const { f, client, options, correction, calls } = await setupCorrection(
    false,
    100000,
  );
  vi.setSystemTime((700 + 23 * 3600) * 1000);
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({
    state: "invoice_adjustment_required",
    reason: "native_cancellation_expired",
    restoredQuantity: "0",
  });
  expect(calls).toHaveLength(0);
});

it("does not send a native cancellation if billing closes during provider preflight", async () => {
  const { f, client, options, correction, state, calls } =
    await setupCorrection();
  state.advanceAtInvoiceRead = 500000;
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({
    state: "invoice_adjustment_required",
    restoredQuantity: "0",
  });
  expect(calls).toHaveLength(0);
});

it("holds native cancellation when a potentially finalized usage line has no quantity evidence", async () => {
  const { f, client, options, correction, state, calls } =
    await setupCorrection();
  state.finalized = true;
  state.missingEvidence = true;
  expect(
    await f.t.action((ctx) =>
      client.usage.requestCorrection(ctx as RunCtx, correction, options),
    ),
  ).toMatchObject({
    state: "held",
    reason: "native_invoice_history_incomplete",
    restoredQuantity: "0",
  });
  expect(calls).toHaveLength(0);
});
