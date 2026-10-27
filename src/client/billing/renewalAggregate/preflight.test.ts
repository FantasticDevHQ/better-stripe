import { expect, it } from "vitest";
import { preflightRenewalReplacement } from "./index.js";
import {
  alter,
  fixture,
  stamp,
} from "../../../../tests/renewalAggregate/fixtures.js";

it("preflights exact cross-product paid terms without claiming provider qualification", () => {
  const f = fixture();
  const before = structuredClone(f.preflightInput);
  const result = preflightRenewalReplacement(f.preflightInput);
  expect(result).toMatchObject({
    status: "preflighted_for_projection",
    scope: "platform",
    expected: f.prepared.expected,
    quantity: 3,
    providerQualification: "required",
    profile: {
      apiVersion: "2026-09-30.endive",
      billingMode: "classic",
      cadence: "same",
      anchor: "ordinary",
    },
  });
  expect(f.preflightInput).toEqual(before);
  expect(result.status).not.toBe("pending");
  expect(result.status).not.toBe("effective");
});

it("rejects an empty discount hierarchy before attach despite observed ancestor absence", () => {
  const f = fixture({
    subscription: { discounts: [] },
    item: { discounts: [] },
  });
  expect(f.billingCustomer.discount).toBeNull();
  expect(preflightRenewalReplacement(f.preflightInput)).toMatchObject({
    status: "unsupported",
    reason: expect.stringMatching(/discount|inherit/i),
  });
});

it.each([
  {
    billing_thresholds: { amount_gte: 100, reset_billing_cycle_anchor: false },
  },
  { managed_payments: { enabled: true } },
  { trial_end: stamp("2026-02-01T00:00:00Z") },
  { next_pending_invoice_item_invoice: stamp("2026-01-25T00:00:00Z") },
  { billing_mode: { type: "future_mode", flexible: null } },
])(
  "rejects known unproven original settings before attach %j",
  (subscription) => {
    expect(
      preflightRenewalReplacement(fixture({ subscription }).preflightInput),
    ).toMatchObject({ status: "unsupported", reason: expect.any(String) });
  },
);

it.each([
  ["customer_account", "acct_foreign"],
  ["customer", "cus_foreign"],
  ["currency", "eur"],
  ["schedule", "sub_sched_foreign"],
  ["cancel_at_period_end", true],
] as const)("rejects fresh original drift at %s", (field, value) => {
  const input = alter(
    fixture().preflightInput,
    ["freshSubscription", field],
    value,
  );
  const result = preflightRenewalReplacement(input);
  expect(["unsupported", "conflict"]).toContain(result.status);
  expect(result).toHaveProperty("reason", expect.any(String));
});

it("rejects a forged logical binding rather than trusting its string", () => {
  const result = preflightRenewalReplacement(
    alter(
      fixture().preflightInput,
      ["prepared", "requestIdentity", "binding"],
      "renewal:v1:forged",
    ),
  );
  expect(result).toMatchObject({
    status: "conflict",
    reason: expect.stringMatching(/binding|prepared|identity/i),
  });
});

it.each([
  [["freshSubscription", "id"], "sub_other"],
  [["freshSubscription", "items", "data", 0, "id"], "si_other"],
  [["freshSubscription", "items", "data", 0, "quantity"], 4],
  [["freshSubscription", "items", "data", 0, "current_period_end"], 999],
  [["freshSubscription", "items", "data", 0, "price", "id"], "price_other"],
  [
    ["freshSubscription", "items", "data", 0, "price", "product"],
    "other-product",
  ],
  [["freshSubscription", "items", "has_more"], true],
  [["targetPrice", "id"], "price_other"],
  [["targetPrice", "product"], "other-product"],
  [["targetPrice", "active"], false],
  [["targetPrice", "currency"], "eur"],
  [["targetPrice", "livemode"], true],
  [["billingCustomer", "customer_account"], "acct_other"],
  [["billingCustomer", "deleted"], true],
] as const)(
  "rejects exact selector or incomplete read drift at %j",
  (path, value) => {
    const result = preflightRenewalReplacement(
      alter(fixture().preflightInput, [...path], value),
    );
    expect(["unsupported", "conflict"]).toContain(result.status);
    expect(result).toHaveProperty("reason", expect.any(String));
  },
);

it("classifies flexible billing explicitly without silently migrating it", () => {
  const f = fixture({
    subscription: {
      billing_mode: {
        type: "flexible",
        flexible: { proration_discounts: "included" },
        updated_at: stamp("2025-12-01T00:00:00Z"),
      },
    },
  });
  expect(preflightRenewalReplacement(f.preflightInput)).toMatchObject({
    status: "preflighted_for_projection",
    providerQualification: "required",
    profile: { billingMode: "flexible", cadence: "same" },
  });
});

it("treats a different recurring count as changed cadence", () => {
  expect(
    preflightRenewalReplacement(fixture({ targetCount: 3 }).preflightInput),
  ).toMatchObject({
    status: "preflighted_for_projection",
    profile: { cadence: "changed" },
    providerQualification: "required",
  });
});

it.each([
  [
    "2026-01-31T00:00:00Z",
    "2026-02-28T00:00:00Z",
    "2026-02-01T00:00:00Z",
    "month",
  ],
  [
    "2024-01-31T00:00:00Z",
    "2024-02-29T00:00:00Z",
    "2024-02-01T00:00:00Z",
    "month",
  ],
  [
    "2024-02-29T00:00:00Z",
    "2025-02-28T00:00:00Z",
    "2024-06-01T00:00:00Z",
    "year",
  ],
] as const)(
  "retains calendar-edge qualification for %s",
  (start, end, observed, interval) => {
    const f = fixture({
      start: stamp(start),
      end: stamp(end),
      observedAt: stamp(observed),
      currentInterval: interval,
      targetInterval: interval,
    });
    expect(preflightRenewalReplacement(f.preflightInput)).toMatchObject({
      status: "preflighted_for_projection",
      providerQualification: "required",
      profile: { anchor: "calendar_edge", cadence: "same" },
    });
  },
);

it("keeps changed-cadence anchor configuration explicitly unsupported", () => {
  const f = fixture({
    targetInterval: "year",
    subscription: {
      billing_cycle_anchor_config: {
        day_of_month: 15,
        month: null,
        hour: 0,
        minute: 0,
        second: 0,
      },
    },
  });
  expect(preflightRenewalReplacement(f.preflightInput)).toMatchObject({
    status: "unsupported",
    reason: expect.stringMatching(/anchor|cadence/i),
  });
});

it("does not normalize an explicit preview version to endive", () => {
  const result = preflightRenewalReplacement({
    ...fixture().preflightInput,
    apiVersion: "2026-09-30.preview",
  });
  expect(result).toMatchObject({
    status: "unsupported",
    reason: expect.stringMatching(/version|preview/i),
  });
});

it.each([
  { id: "custom-target", object: "customer", livemode: false },
  { id: "custom-target", object: "product", livemode: true },
])("rejects contradictory expanded target product facts %j", (product) => {
  if (product.object !== "product") {
    const malformedFreshRead = alter(
      fixture().preflightInput,
      ["targetPrice", "product"],
      product,
    );
    expect(preflightRenewalReplacement(malformedFreshRead).status).toBe(
      "unsupported",
    );
    return;
  }
  const f = fixture({ target: { product } });
  expect(preflightRenewalReplacement(f.preflightInput).status).toBe(
    "unsupported",
  );
});
