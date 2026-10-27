import { expect, it } from "vitest";
import { projectRenewalConfiguration } from "./index.js";
import { alter, fixture } from "../../../../tests/renewalAggregate/fixtures.js";

it("projects the exact current paid phase and target phase without default writes", () => {
  const f = fixture();
  const before = structuredClone(f.configureInput);
  const result = projectRenewalConfiguration(f.configureInput);
  expect(result).toMatchObject({
    version: 1,
    stage: "configure",
    scope: "platform",
    status: "projected_configure_request",
    providerQualification: "required",
    apiVersion: "2026-09-30.endive",
    scheduleId: "sub_sched_owned",
    attachReceiptBinding: f.attachReceipt.binding,
    baselineBinding: expect.any(String),
    defaultSettingsBinding: expect.any(String),
    firstDispatchedAt: f.configureInput.firstDispatchedAt,
    requestIdentity: {
      key: "renewal:configure-original",
      binding: expect.any(String),
    },
    payload: {
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        {
          start_date: f.prepared.expected.periodStart,
          end_date: f.prepared.expected.periodEnd,
          currency: "usd",
          items: [
            {
              price: "price_original",
              quantity: 3,
              tax_rates: "",
              discounts: [{ discount: "di_item" }],
            },
          ],
          default_tax_rates: "",
          discounts: [{ discount: "di_subscription" }],
          proration_behavior: "create_prorations",
        },
        {
          start_date: f.prepared.expected.periodEnd,
          duration: { interval: "month", interval_count: 1 },
          billing_cycle_anchor: "automatic",
          currency: "usd",
          items: [
            {
              price: "price_target",
              quantity: 3,
              tax_rates: "",
              discounts: [{ discount: "di_item" }],
            },
          ],
          default_tax_rates: "",
          discounts: [{ discount: "di_subscription" }],
          proration_behavior: "none",
        },
      ],
    },
  });
  expect(result).not.toHaveProperty("payload.default_settings");
  expect(result).not.toHaveProperty("payload.phases.1.end_date");
  expect(result).not.toHaveProperty("payload.phases.0.items.0.plan");
  expect(result).not.toHaveProperty("payload.phases.1.items.0.id");
  for (const phase of [0, 1]) {
    expect(result).not.toHaveProperty(
      `payload.phases.${phase}.discounts.0.coupon`,
    );
    expect(result).not.toHaveProperty(
      `payload.phases.${phase}.discounts.0.promotion_code`,
    );
    expect(result).not.toHaveProperty(
      `payload.phases.${phase}.items.0.discounts.0.coupon`,
    );
  }
  expect(f.configureInput).toEqual(before);
});

it.each(["none", "always_invoice", "create_prorations"])(
  "preserves acknowledged current phase proration mode %s",
  (proration_behavior) => {
    expect(
      projectRenewalConfiguration(
        fixture({ phase: { proration_behavior } }).configureInput,
      ),
    ).toMatchObject({
      status: "projected_configure_request",
      payload: {
        proration_behavior: "none",
        phases: [{ proration_behavior }, { proration_behavior: "none" }],
      },
    });
  },
);

it("binds the explicit configure key without reusing the attach key", () => {
  const f = fixture();
  const first = projectRenewalConfiguration(f.configureInput);
  const second = projectRenewalConfiguration({
    ...f.configureInput,
    configureKey: "renewal:configure-other",
  });
  expect(first).toMatchObject({ status: "projected_configure_request" });
  expect(second).toMatchObject({ status: "projected_configure_request" });
  if (
    first.status !== "projected_configure_request" ||
    second.status !== "projected_configure_request"
  )
    return;
  expect(first.payload).toEqual(second.payload);
  expect(first.requestIdentity.binding).not.toBe(
    second.requestIdentity.binding,
  );
  expect(
    projectRenewalConfiguration({
      ...f.configureInput,
      configureKey: f.attachRequest.requestIdentity.key,
    }).status,
  ).not.toBe("projected_configure_request");
});

it("uses the provider-verified renewal and a changed-cadence phase-start anchor", () => {
  const f = fixture({ targetInterval: "year" });
  const result = projectRenewalConfiguration(f.configureInput);
  expect(result).toMatchObject({
    status: "projected_configure_request",
    profile: { cadence: "changed" },
    providerQualification: "required",
    payload: {
      phases: [
        expect.any(Object),
        {
          start_date: f.prepared.expected.periodEnd,
          duration: { interval: "year", interval_count: 1 },
          billing_cycle_anchor: "phase_start",
          proration_behavior: "none",
        },
      ],
    },
  });
});

it("validates the actual post-attach association instead of pretending schedule is null", () => {
  const input = fixture().configureInput;
  expect(projectRenewalConfiguration(input).status).toBe(
    "projected_configure_request",
  );
  const result = projectRenewalConfiguration(
    alter(input, ["freshSubscription", "schedule"], null),
  );
  expect(result).toMatchObject({
    status: "conflict",
    reason: expect.stringMatching(/schedule|association/i),
  });
});

it.each(
  [
    ["request", "payload", "from_subscription"],
    ["providerSnapshot", "default_settings", "description"],
    ["binding"],
  ].map((path) => ({ path })),
)("rejects altered retained acknowledgement at %j", ({ path }) => {
  const next = alter(
    fixture().configureInput,
    ["attachReceipt", ...path],
    "forged",
  );
  expect(projectRenewalConfiguration(next)).toMatchObject({
    status: "conflict",
    reason: expect.stringMatching(/binding|receipt|acknowledg/i),
  });
});

it.each(
  [
    ["default_settings", "description"],
    ["phases", 0, "items", 0, "quantity"],
    ["current_phase", "end_date"],
  ].map((path) => ({ path })),
)("rejects fresh acknowledged-baseline drift at %j", ({ path }) => {
  const result = projectRenewalConfiguration(
    alter(
      fixture().configureInput,
      ["schedule", ...path],
      path[path.length - 1] === "description" ? "changed" : 999,
    ),
  );
  expect(result).toMatchObject({
    status: "conflict",
    reason: expect.stringMatching(/baseline|default|drift|period|phase/i),
  });
});

it("does not adopt unrelated extra future phases or release them as a workaround", () => {
  const f = fixture();
  const result = projectRenewalConfiguration(
    alter(
      f.configureInput,
      ["schedule", "phases"],
      [
        ...f.schedule.phases,
        {
          ...f.schedule.phases[0],
          start_date: f.prepared.expected.periodEnd,
          end_date: f.prepared.expected.periodEnd + 100,
        },
      ],
    ),
  );
  expect(result.status).toBe("conflict");
  expect(result).not.toHaveProperty("payload");
  expect(result).not.toHaveProperty("releaseRequest");
});

it("keeps an acknowledged schedule partial when a paid-term mapping is unsupported", () => {
  const f = fixture({
    phase: { add_invoice_items: [{ price: "price_extra" }] },
  });
  expect(projectRenewalConfiguration(f.configureInput)).toMatchObject({
    status: "attached_unconfigured",
    scheduleId: "sub_sched_owned",
    reason: expect.stringMatching(/invoice|unsupported|mapping/i),
  });
});

it("rejects unknown defaults even though the request would leave defaults untouched", () => {
  const f = fixture({ defaults: { future_unmapped_setting: true } });
  expect(projectRenewalConfiguration(f.configureInput)).toMatchObject({
    status: "attached_unconfigured",
    reason: expect.stringMatching(/default|unsupported|unknown/i),
  });
});

it("rejects resetting a current phase-start anchor away from the original anchor", () => {
  const f = fixture({
    subscription: { billing_cycle_anchor: 1765756800 },
    phase: { billing_cycle_anchor: "phase_start" },
  });
  expect(projectRenewalConfiguration(f.configureInput)).toMatchObject({
    status: "attached_unconfigured",
    reason: expect.stringMatching(/anchor/i),
  });
});

it("copies only acknowledged metadata actions that already match current terms", () => {
  const f = fixture({
    subscription: {
      metadata: {
        keep: "original",
        unrelated: "do-not-turn-into-a-phase-action",
      },
    },
    phase: { metadata: { keep: "original" } },
    phaseItem: { metadata: { seat: "retained" } },
  });
  const result = projectRenewalConfiguration(f.configureInput);
  expect(result).toMatchObject({
    status: "projected_configure_request",
    payload: {
      phases: [
        expect.any(Object),
        {
          metadata: { keep: "original" },
          items: [{ metadata: { seat: "retained" } }],
        },
      ],
    },
  });
  expect(result).not.toHaveProperty("payload.phases.1.metadata.unrelated");
  const conflict = fixture({ phase: { metadata: { keep: "overwrite" } } });
  const rejected = projectRenewalConfiguration(conflict.configureInput);
  expect(rejected.status).not.toBe("projected_configure_request");
  expect(rejected).toHaveProperty(
    "reason",
    expect.stringMatching(/metadata|conflict/i),
  );
});

it("rejects manual phase rates under effective automatic tax inherited from defaults", () => {
  const automatic = { enabled: true, liability: null, disabled_reason: null };
  const f = fixture({
    subscription: { automatic_tax: automatic },
    defaults: { automatic_tax: automatic },
    phase: {
      default_tax_rates: [
        { id: "txr_manual", object: "tax_rate", livemode: false },
      ],
    },
  });
  expect(projectRenewalConfiguration(f.configureInput)).toMatchObject({
    status: "attached_unconfigured",
    reason: expect.stringMatching(/tax/i),
  });
});

it("rejects a future first-dispatch time instead of resetting retained time", () => {
  const f = fixture();
  const result = projectRenewalConfiguration({
    ...f.configureInput,
    firstDispatchedAt: f.configureInput.observedAt + 1,
  });
  expect(result.status).not.toBe("projected_configure_request");
  expect(result).toHaveProperty(
    "reason",
    expect.stringMatching(/time|dispatch/i),
  );
});

it.each([
  { price: { id: "price_original", object: "price", livemode: true } },
  {
    price: {
      id: "price_original",
      object: "price",
      product: "foreign-product",
    },
  },
  { plan: { id: "price_original", object: "plan", livemode: true } },
])("rejects contradictory expanded phase price/plan facts %j", (phaseItem) => {
  const f = fixture({ phaseItem });
  expect(projectRenewalConfiguration(f.configureInput).status).not.toBe(
    "projected_configure_request",
  );
});

it("rejects an inherited tax liability that contradicts the original effective liability", () => {
  const f = fixture({
    subscription: {
      automatic_tax: {
        enabled: true,
        liability: { type: "self" },
        disabled_reason: null,
      },
    },
    defaults: {
      automatic_tax: {
        enabled: true,
        liability: { type: "account", account: "acct_other" },
        disabled_reason: null,
      },
    },
  });
  expect(projectRenewalConfiguration(f.configureInput).status).not.toBe(
    "projected_configure_request",
  );
});

it("rejects invoice tax IDs that contradict the current subscription's invoice settings", () => {
  const base = fixture();
  const f = fixture({
    subscription: {
      invoice_settings: {
        ...base.subscription.invoice_settings,
        account_tax_ids: ["txi_original"],
      },
    },
    defaults: {
      invoice_settings: {
        ...base.schedule.default_settings.invoice_settings,
        account_tax_ids: ["txi_other"],
      },
    },
  });
  expect(projectRenewalConfiguration(f.configureInput).status).not.toBe(
    "projected_configure_request",
  );
});
