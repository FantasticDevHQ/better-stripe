import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { convexTest } from "convex-test";
import { componentsGeneric, defineSchema } from "convex/server";
import { BetterStripe } from "@fantastic.dev/better-stripe";
import {
  defineUsagePlan,
  prepareUsageRecord,
} from "@fantastic.dev/better-stripe/usage";
import {
  UsageSummary,
  UsageAllowance,
  UsageCredits,
} from "@fantastic.dev/better-stripe/react";
import schema from "./dist/component/schema.js";
const imports = import.meta.glob("./dist/component/**/*.js");
const modules = Object.fromEntries(
  Object.entries(imports).map(([path, load]) => [
    path.replace("./dist/component/", "./"),
    load,
  ]),
);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const subscription = {
  subscriptionId: "sub_calls",
  subscriptionItemId: "si_calls",
  stripePriceId: "price_calls",
  period: { start: 600, end: 1200 },
  interval: "month",
};
const native = {
  id: "sub_calls",
  latest_invoice: "in_initial",
  livemode: false,
  customer_account: "acct_buyer",
  customer: "cus_buyer",
  status: "active",
  currency: "usd",
  collection_method: "send_invoice",
  days_until_due: 30,
  default_payment_method: null,
  billing_mode: { type: "flexible" },
  cancel_at_period_end: false,
  cancel_at: null,
  items: {
    data: [
      {
        id: "si_calls",
        current_period_start: 600,
        current_period_end: 1200,
        quantity: null,
        price: {
          id: "price_calls",
          currency: "usd",
          recurring: {
            interval: "month",
            interval_count: 1,
            usage_type: "metered",
            meter: "mtr_calls",
          },
          unit_amount_decimal: null,
        },
      },
    ],
    has_more: false,
  },
};
it.each(["pay_as_you_go", "included_overage", "prepaid"])(
  "consumes %s exactly once through public APIs and renders actual accounting",
  async (model) => {
    vi.useFakeTimers();
    vi.setSystemTime(700000);
    const network = vi.fn(async () => {
      throw new Error("Unexpected provider I/O");
    });
    vi.stubGlobal("fetch", network);
    for (const [name, path] of [
      ["", "dist/client/index.js"],
      ["/usage", "dist/client/usage/index.js"],
      ["/react", "dist/react/index.js"],
    ])
      assert.equal(
        fileURLToPath(
          import.meta.resolve(`@fantastic.dev/better-stripe${name}`),
        ),
        resolve(path),
      );
    const t = convexTest(defineSchema({}), modules);
    t.registerComponent("betterStripe", schema, modules);
    const component = componentsGeneric().betterStripe;
    const stripe = new BetterStripe(component);
    const plan = defineUsagePlan({
      key: "calls",
      version: "v1",
      model,
      unit: { name: "call", precision: 0 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
      ...(model === "included_overage"
        ? { includedQuantity: "10", reset: "billing_period" }
        : {}),
      ...(model === "prepaid" ? { insufficientBalance: "reject" } : {}),
    });
    const meter = {
      scope: {
        stripeAccountId: "acct_platform",
        customerAccount: "acct_buyer",
        meterId: "mtr_calls",
        livemode: false,
      },
      binding: {
        stripeCustomerId: "cus_buyer",
        stripePriceId: "price_calls",
        eventName: "calls",
        plan,
      },
    };
    // Deterministic component fixture, not a claim of native provider I/O.
    const intent = await t.run((ctx) =>
      ctx.runMutation(component.usageSubscriptions.mutations.prepare, {
        termsJson: JSON.stringify({
          requestId: "signup",
          meters: [meter],
          fixedPriceIds: [],
          collection: { method: "send_invoice", daysUntilDue: 30 },
        }),
        method: "direct",
      }),
    );
    await t.run((ctx) =>
      ctx.runMutation(component.usageSubscriptions.mutations.save, {
        key: intent.key,
        nativeJson: JSON.stringify(native),
        startedAt: Date.now(),
      }),
    );
    if (model !== "prepaid")
      await t.run((ctx) =>
        stripe.usage.configureAllowance(ctx, {
          ...meter,
          subscription,
          expectedRevision: 0,
          policy: {
            reset: "billing_period",
            rollover: "none",
            entitled: true,
            overage: "allow",
            limit: { mode: "hard", quantity: "12" },
          },
        }),
      );
    if (model === "prepaid") {
      const purchase = {
        ...meter,
        purchaseId: "topup",
        quantity: "10",
        ownership: "issuer",
        rollover: "retain_original_terms",
      };
      const row = await t.run((ctx) =>
        ctx.runMutation(component.usageCredits.mutations.preparePurchase, {
          inputJson: JSON.stringify(purchase),
        }),
      );
      await t.run((ctx) =>
        ctx.runMutation(component.usageCredits.mutations.pinPayment, {
          key: row.key,
          paymentIntentId: "pi_original",
        }),
      );
      // An unpaid purchase cannot authorize work. Only the fixture's verified original backing unlocks it.
      const unpaid = {
        ...meter,
        sourceEventId: "unpaid",
        quantity: "1",
        occurredAt: 700,
      };
      await assert.rejects(
        t.run((ctx) =>
          stripe.usage.reserveCredits(ctx, { event: unpaid, subscription }),
        ),
      );
      const proof = {
        paymentIntentId: "pi_original",
        chargeId: "ch_original",
        amount: 20,
        currency: "usd",
        customerAccount: "acct_buyer",
        livemode: false,
      };
      await t.run((ctx) =>
        ctx.runMutation(component.usageCredits.mutations.verifyPayment, {
          key: row.key,
          proofJson: JSON.stringify(proof),
        }),
      );
      await t.run((ctx) =>
        ctx.runMutation(component.usageCredits.mutations.pinGrant, {
          key: row.key,
          proofJson: JSON.stringify({
            ...proof,
            creditGrantId: "credgr_original",
            stripePriceId: "price_calls",
            createdAt: 700,
            effectiveAt: 700,
            expiresAt: null,
          }),
        }),
      );
    }
    const event = {
      ...meter,
      sourceEventId: "work",
      quantity: "6",
      occurredAt: 700,
    };
    const accept = (input) =>
      t.run(async (ctx) => {
        const reservation = await (model === "prepaid"
          ? stripe.usage.reserveCredits(ctx, { event: input, subscription })
          : stripe.usage.reserveAllowance(ctx, { event: input, subscription }));
        assert.notEqual(reservation.state, "denied");
        return stripe.usage.record(ctx, {
          event: prepareUsageRecord(input),
          subscription,
          reservationId: reservation.reservationId,
        });
      });
    const receipt = await accept(event);
    assert.deepEqual(await accept(event), receipt);
    await assert.rejects(accept({ ...event, quantity: "5" }));
    const second = {
      ...event,
      sourceEventId: "second",
      quantity: model === "prepaid" ? "4" : "6",
    };
    const race = await Promise.allSettled([
      accept(second),
      accept({ ...second, sourceEventId: "competing_last_units" }),
    ]);
    assert.deepEqual(race.map((result) => result.status).sort(), [
      "fulfilled",
      "rejected",
    ]);
    if (model === "prepaid")
      await assert.rejects(
        accept({ ...event, sourceEventId: "exhausted", quantity: "1" }),
      );
    else
      await assert.rejects(
        accept({ ...event, sourceEventId: "over_cap", quantity: "1" }),
      );
    const page = await t.run((ctx) =>
      stripe.usage.read(ctx, {
        scope: meter.scope,
        page: { period: subscription.period, limit: 10, cursor: null },
      }),
    );
    assert.equal(page.events.length, 2);
    assert.equal(
      page.events.reduce(
        (sum, row) => sum + BigInt(row.record.scaledQuantity),
        0n,
      ),
      model === "prepaid" ? 10n : 12n,
    );
    if (model === "prepaid") {
      const balance = await t.run((ctx) =>
        stripe.usage.getCreditBalance(ctx, meter),
      );
      assert.equal(balance.consumedQuantity, "10");
      assert.equal(balance.availableQuantity, "0");
      assert.equal(balance.cashCollection, "none");
      const html = renderToStaticMarkup(
        createElement(UsageCredits, {
          balance: { status: "available", value: balance },
        }),
      );
      assert.match(html, /Consumed/);
      assert.match(html, /10 call/);
    } else {
      const allowance = await t.run((ctx) =>
        stripe.usage.getAllowanceStatus(ctx, { ...meter, subscription }),
      );
      assert.equal(allowance.consumedQuantity, "12");
      assert.equal(allowance.reservedQuantity, "0");
      assert.equal(
        allowance.billableOverageQuantity,
        model === "included_overage" ? "2" : "12",
      );
      assert.equal(
        allowance.committedEstimate.amountDecimal,
        model === "included_overage" ? "4" : "24",
      );
      const html = renderToStaticMarkup(
        createElement(UsageAllowance, {
          allowance: { status: "available", value: allowance },
          unit: "call",
        }),
      );
      assert.match(html, /Billable overage/);
      assert.match(html, model === "included_overage" ? /2 call/ : /12 call/);
    }
    const unavailable = renderToStaticMarkup(
      createElement(UsageSummary, {
        scope: {
          identityKey: "buyer",
          accountKey: "acct_buyer",
          meterKey: "mtr_calls",
          period: subscription.period,
          currency: "usd",
        },
        summary: {
          status: "unavailable",
          reason: "provider_lag",
          retryable: true,
        },
      }),
    );
    assert.match(unavailable, /unavailable/);
    assert.doesNotMatch(unavailable, /No usage/);
    assert.equal(network.mock.calls.length, 0);
  },
);
