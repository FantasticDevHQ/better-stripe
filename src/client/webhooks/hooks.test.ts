/**
 * Tests for `scheduleAsyncHook` — the post-commit async-hook scheduler that maps
 * a Stripe event type to at most one app hook, fetches the just-committed
 * component doc, and schedules the app's `asyncWebhook` action with it.
 *
 * BTS-33 focus: `invoice.payment_failed` must schedule an INVOICE-level
 * payment-failed hook (`afterInvoicePaymentFailed`) so an app can react to a
 * failed subscription cycle (dunning). Before BTS-33 this event upserted the
 * invoice but fired no hook — the gap this suite pins shut.
 */
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";

import type { Component } from "../helpers.js";
import type { WebhookContext } from "./helpers.js";
import { scheduleAsyncHook } from "./hooks.js";

const TO_REF = Symbol.for("toReferencePath");
const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });

const ASYNC_WEBHOOK_REF = ref("stripe/asyncWebhook");

function makeComponent(): Component {
  return {
    billing: {
      queries: {
        getInvoiceByStripeId: ref("billing/queries/getInvoiceByStripeId"),
      },
    },
  } as unknown as Component;
}

function makeWhCtx(opts?: {
  doc?: unknown;
  withScheduler?: boolean;
  withRefs?: boolean;
}): WebhookContext & {
  ctx: { runQuery: Mock; scheduler: { runAfter: Mock } | undefined };
} {
  const runAfter = vi.fn().mockResolvedValue(undefined);
  return {
    ctx: {
      runQuery: vi.fn().mockResolvedValue(opts?.doc ?? null),
      scheduler:
        opts?.withScheduler === false ? undefined : { runAfter },
    },
    component: makeComponent(),
    stripe: {} as never,
    webhookSecret: "whsec_test",
    config:
      opts?.withRefs === false
        ? {}
        : ({ webhooks: { asyncWebhook: ASYNC_WEBHOOK_REF } } as never),
  } as unknown as WebhookContext & {
    ctx: { runQuery: Mock; scheduler: { runAfter: Mock } | undefined };
  };
}

const invoiceDoc = {
  _id: "invoices_1",
  stripeInvoiceId: "in_failed",
  status: "open",
  nextPaymentAttempt: "2030-02-01T00:00:00.000Z",
  attemptCount: 1,
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("scheduleAsyncHook — invoice.payment_failed (BTS-33)", () => {
  it("schedules afterInvoicePaymentFailed with the committed invoice doc", async () => {
    const whCtx = makeWhCtx({ doc: invoiceDoc });

    await scheduleAsyncHook(whCtx, "invoice.payment_failed", "in_failed");

    // Fetched the committed invoice by its Stripe id.
    expect(whCtx.ctx.runQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        [TO_REF]: "betterStripe/billing/queries/getInvoiceByStripeId",
      }),
      { stripeInvoiceId: "in_failed" },
    );
    // Scheduled the invoice-level payment-failed hook with that doc.
    const runAfter = whCtx.ctx.scheduler!.runAfter;
    expect(runAfter).toHaveBeenCalledWith(0, ASYNC_WEBHOOK_REF, {
      hook: "afterInvoicePaymentFailed",
      doc: invoiceDoc,
    });
  });

  it("does not schedule when the invoice is not yet committed", async () => {
    const whCtx = makeWhCtx({ doc: null });

    await scheduleAsyncHook(whCtx, "invoice.payment_failed", "in_failed");

    expect(whCtx.ctx.scheduler!.runAfter).not.toHaveBeenCalled();
  });

  it("still maps invoice.paid to afterInvoicePaid (unchanged)", async () => {
    const whCtx = makeWhCtx({ doc: { _id: "invoices_2" } });

    await scheduleAsyncHook(whCtx, "invoice.paid", "in_paid");

    expect(whCtx.ctx.scheduler!.runAfter).toHaveBeenCalledWith(
      0,
      ASYNC_WEBHOOK_REF,
      expect.objectContaining({ hook: "afterInvoicePaid" }),
    );
  });
});
