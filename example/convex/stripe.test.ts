// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Tests for the example app's BetterStripe wiring (`stripe.ts`).
 *
 * `stripe.ts` is the single place the demo wires `new BetterStripe(...)` with
 * its sync-trigger and async-hook callbacks. Those callbacks are the example's
 * own code: each is supposed to write an observability row into the `triggerLog`
 * table (via `internal.triggerLogger.record`) with a specific `source`/`kind`
 * and the right Stripe id pulled off the document.
 *
 * The bodies of those callbacks are only ever executed by the component's
 * webhook dispatcher at runtime, so unit coverage requires invoking them
 * directly. We pull the configured callbacks off the constructed instance and
 * drive each one through a real convex-test mutation context, then assert the
 * exact row it persisted — i.e. that the example wired the correct
 * source/kind/stripeId for every trigger and hook.
 *
 * The Stripe-API-backed surface (createCheckoutSession, syncAllProducts, the
 * webhook HTTP verification, etc.) is exercised by the library's own test suite
 * and the non-CI e2e:webhooks script; it cannot run in a unit test without a
 * live Stripe key, so it is intentionally not covered here.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "./schema";
import { asyncWebhook, stripe, syncWebhook } from "./stripe";

const modules = import.meta.glob("./**/*.*s");

// The trigger/hook callbacks are stored on private fields of the instance.
// They are the literal config objects passed in stripe.ts, reachable at runtime.
type Cb = (ctx: unknown, ...docs: unknown[]) => Promise<void>;
const triggers = (stripe as unknown as { _triggers: Record<string, never> })
  ._triggers as unknown as {
  subscription: { onCreate: Cb; onUpdate: Cb; onDelete: Cb };
  checkoutSession: { onCompleted: Cb };
};
const hooks = (stripe as unknown as { _hooks: Record<string, never> })
  ._hooks as unknown as {
  onPayoutCompleted: Cb;
  onInvoicePaid: Cb;
  onPaymentFailed: Cb;
  onTrialEnding: Cb;
};

type TriggerLogRow = {
  source: "trigger" | "hook";
  kind: string;
  stripeId: string;
};

async function runCallback(
  fn: Cb,
  ...docs: unknown[]
): Promise<TriggerLogRow[]> {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    // The sync-trigger / async-hook context only needs runMutation, which the
    // convex-test mutation ctx provides.
    await fn(ctx, ...docs);
  });
  const rows = await t.run(async (ctx) =>
    ctx.db.query("triggerLog").collect(),
  );
  return rows.map((r) => ({
    source: r.source,
    kind: r.kind,
    stripeId: r.stripeId,
  }));
}

// =============================================================================
// EXPORTS — the wired instance and the webhook handler pair
// =============================================================================

describe("stripe.ts — module exports", () => {
  it("exports a configured BetterStripe instance plus the webhook handler pair", () => {
    // The instance the rest of the app delegates to.
    expect(typeof stripe.createCheckoutSession).toBe("function");
    expect(typeof stripe.listProducts).toBe("function");
    expect(typeof stripe.webhookHandlers).toBe("function");

    // webhookHandlers() returns the registered function refs that http.ts wires
    // into registerRoutes; both must be present and distinct.
    expect(syncWebhook).toBeDefined();
    expect(asyncWebhook).toBeDefined();
    expect(syncWebhook).not.toBe(asyncWebhook);
  });

  it("registers all four sync triggers and four async hooks the demo defines", () => {
    expect(typeof triggers.subscription.onCreate).toBe("function");
    expect(typeof triggers.subscription.onUpdate).toBe("function");
    expect(typeof triggers.subscription.onDelete).toBe("function");
    expect(typeof triggers.checkoutSession.onCompleted).toBe("function");

    expect(typeof hooks.onPayoutCompleted).toBe("function");
    expect(typeof hooks.onInvoicePaid).toBe("function");
    expect(typeof hooks.onPaymentFailed).toBe("function");
    expect(typeof hooks.onTrialEnding).toBe("function");
  });
});

// =============================================================================
// SYNC TRIGGERS — each records a `trigger` row with the right kind + stripeId
// =============================================================================

describe("stripe.ts — sync triggers record to triggerLog", () => {
  it("subscription.onCreate records the new subscription id", async () => {
    const rows = await runCallback(triggers.subscription.onCreate, {
      stripeSubscriptionId: "sub_create_1",
      userId: "user_1",
      status: "active",
    });

    expect(rows).toEqual([
      {
        source: "trigger",
        kind: "subscription.onCreate",
        stripeId: "sub_create_1",
      },
    ]);
  });

  it("subscription.onUpdate records the new doc's id (old/new status both read)", async () => {
    const rows = await runCallback(
      triggers.subscription.onUpdate,
      // newDoc
      {
        stripeSubscriptionId: "sub_update_1",
        userId: "user_1",
        status: "past_due",
      },
      // oldDoc — onUpdate logs `${oldDoc.status} -> ${newDoc.status}`
      {
        stripeSubscriptionId: "sub_update_1",
        userId: "user_1",
        status: "active",
      },
    );

    expect(rows).toEqual([
      {
        source: "trigger",
        kind: "subscription.onUpdate",
        stripeId: "sub_update_1",
      },
    ]);
  });

  it("subscription.onDelete records the deleted subscription id", async () => {
    const rows = await runCallback(triggers.subscription.onDelete, {
      stripeSubscriptionId: "sub_delete_1",
      userId: "user_1",
      status: "canceled",
    });

    expect(rows).toEqual([
      {
        source: "trigger",
        kind: "subscription.onDelete",
        stripeId: "sub_delete_1",
      },
    ]);
  });

  it("checkoutSession.onCompleted records the completed session id", async () => {
    const rows = await runCallback(triggers.checkoutSession.onCompleted, {
      stripeSessionId: "cs_completed_1",
      mode: "subscription",
    });

    expect(rows).toEqual([
      {
        source: "trigger",
        kind: "checkoutSession.onCompleted",
        stripeId: "cs_completed_1",
      },
    ]);
  });
});

// =============================================================================
// ASYNC HOOKS — each records a `hook` row with the right kind + stripeId
// =============================================================================

describe("stripe.ts — async hooks record to triggerLog", () => {
  it("onPayoutCompleted records the payout id", async () => {
    const rows = await runCallback(hooks.onPayoutCompleted, {
      stripePayoutId: "po_1",
      amount: 5000,
    });

    expect(rows).toEqual([
      { source: "hook", kind: "onPayoutCompleted", stripeId: "po_1" },
    ]);
  });

  it("onInvoicePaid records the invoice id", async () => {
    const rows = await runCallback(hooks.onInvoicePaid, {
      stripeInvoiceId: "in_1",
      amountPaid: 1900,
    });

    expect(rows).toEqual([
      { source: "hook", kind: "onInvoicePaid", stripeId: "in_1" },
    ]);
  });

  it("onPaymentFailed records the payment intent id", async () => {
    const rows = await runCallback(hooks.onPaymentFailed, {
      stripePaymentIntentId: "pi_1",
      amount: 2900,
    });

    expect(rows).toEqual([
      { source: "hook", kind: "onPaymentFailed", stripeId: "pi_1" },
    ]);
  });

  it("onTrialEnding records the subscription id", async () => {
    const rows = await runCallback(hooks.onTrialEnding, {
      stripeSubscriptionId: "sub_trial_1",
      trialEnd: 1893456000,
    });

    expect(rows).toEqual([
      { source: "hook", kind: "onTrialEnding", stripeId: "sub_trial_1" },
    ]);
  });
});

describe("stripe.ts — platform fee configuration", () => {
  it("configures the tiered marketplace fee (Skool-style: 2.9% + 30¢ up to $899, 3.9% + 30¢ above)", () => {
    expect(stripe.platformFee).toEqual({
      percent: 2.9,
      fixed: 30,
      tiers: [
        { upTo: 89_900, percent: 2.9, fixed: 30 },
        { upTo: null, percent: 3.9, fixed: 30 },
      ],
    });
  });
});
