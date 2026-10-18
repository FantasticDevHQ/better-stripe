import { expect, it } from "vitest";
import {
  subscriptionTerms,
  subscriptionView,
  closeoutPolicy,
} from "./subscriptionTerms.js";
import { request, nativeSubscription, meter } from "./subscription.fixtures.js";
it("normalizes all model bindings and rejects cross-payer or duplicated meters", () => {
  expect(subscriptionTerms(request).meters[0].binding.plan.model).toBe(
    "included_overage",
  );
  expect(() =>
    subscriptionTerms({ ...request, meters: [meter, meter] }),
  ).toThrow();
  expect(() =>
    subscriptionTerms({
      ...request,
      meters: [
        meter,
        {
          ...meter,
          scope: {
            ...meter.scope,
            customerAccount: "acct_other",
            meterId: "mtr_other",
          },
        },
      ],
    }),
  ).toThrow();
});
it("retains every native item and original half-open metered period, including nullable tiered rates", () => {
  const view = subscriptionView(
    nativeSubscription(),
    subscriptionTerms(request),
  );
  expect(view.bindings[0].subscription).toEqual({
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period: { start: 600, end: 1200 },
    interval: "month",
  });
  expect(view.items).toHaveLength(2);
  expect(view.items[0]).toMatchObject({
    quantity: null,
    unitAmountDecimal: null,
  });
  expect(() =>
    subscriptionView(
      {
        ...nativeSubscription(),
        items: { ...nativeSubscription().items, has_more: true },
      },
      subscriptionTerms(request),
    ),
  ).toThrow();
  expect(() =>
    subscriptionView(
      { ...nativeSubscription(), customer_account: "acct_other" },
      subscriptionTerms(request),
    ),
  ).toThrow();
});
it("keeps renewal periods separate and refuses changed native pricing or duplicate meter items", () => {
  const sub = nativeSubscription();
  sub.items.data[0].current_period_start = 1200;
  sub.items.data[0].current_period_end = 1800;
  expect(
    subscriptionView(sub, subscriptionTerms(request)).bindings[0].subscription
      .period,
  ).toEqual({ start: 1200, end: 1800 });
  sub.items.data[0].price.id = "price_other";
  expect(() => subscriptionView(sub, subscriptionTerms(request))).toThrow();
  const duplicate = nativeSubscription();
  duplicate.items.data.push({ ...duplicate.items.data[0], id: "si_duplicate" });
  expect(() =>
    subscriptionView(duplicate, subscriptionTerms(request)),
  ).toThrow();
});
it("exposes cutoff uncertainty and refuses immediate cancellation or silent repricing", () => {
  expect(
    closeoutPolicy({
      queued: 1,
      unknown: 0,
      reservations: 0,
      finalized: false,
    }),
  ).toMatchObject({ ready: false, reason: "pending_usage" });
  expect(
    closeoutPolicy({
      queued: 0,
      unknown: 1,
      reservations: 0,
      finalized: false,
    }),
  ).toMatchObject({ ready: false });
  expect(
    closeoutPolicy({
      queued: 0,
      unknown: 0,
      reservations: 1,
      finalized: false,
    }),
  ).toMatchObject({ ready: false, reason: "pending_reservations" });
  expect(
    closeoutPolicy({
      queued: 0,
      unknown: 0,
      reservations: 0,
      finalized: false,
    }),
  ).toMatchObject({ ready: false, reason: "invoice_not_finalized" });
  expect(
    closeoutPolicy({ queued: 0, unknown: 0, reservations: 0, finalized: true }),
  ).toMatchObject({ ready: true, paymentEvidence: "not_resolved" });
});

it("uses the same subscription contract for all three models without mixing currencies", () => {
  const { key, version, unit, rate } = meter.binding.plan;
  const common = { key, version, unit, rate };
  const plans = [
    { ...common, model: "pay_as_you_go" },
    {
      ...common,
      model: "included_overage",
      includedQuantity: "10",
      reset: "billing_period",
    },
    { ...common, model: "prepaid", insufficientBalance: "reject" },
  ];
  for (const plan of plans)
    expect(
      subscriptionTerms({
        ...request,
        meters: [{ ...meter, binding: { ...meter.binding, plan } }],
      }).meters[0].binding.plan.model,
    ).toBe(plan.model);
});

it("rejects native collection-policy drift instead of hiding an automatic charge policy", () => {
  const sub = {
    ...nativeSubscription(),
    collection_method: "charge_automatically",
    days_until_due: null,
    default_payment_method: "pm_other",
  };
  expect(() => subscriptionView(sub, subscriptionTerms(request))).toThrow();
  expect(
    subscriptionView(nativeSubscription(), subscriptionTerms(request)),
  ).toMatchObject({
    collection: {
      method: "send_invoice",
      daysUntilDue: 30,
      defaultPaymentMethod: null,
    },
  });
});
