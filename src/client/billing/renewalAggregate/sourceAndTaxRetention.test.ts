import { expect, it } from "vitest";
import {
  preflightRenewalReplacement,
  projectRenewalConfiguration,
} from "./index.js";
import { fixture } from "../../../../tests/renewalAggregate/fixtures.js";

const rate = (id: string) => ({ id, object: "tax_rate", livemode: false });
const automatic = (liability: unknown = null) => ({
  enabled: true,
  liability,
  disabled_reason: null,
});

it.each([
  {
    start_date: 1768435200,
    end_date: 1771113600,
    trial_offer: "trial_offer_active",
  },
  {
    start_date: 1771113600,
    end_date: 1773532800,
    trial_offer: "trial_offer_future",
  },
])(
  "rejects an actual item current_trial while the subscription remains active: %j",
  (current_trial) => {
    const f = fixture({ item: { current_trial } });
    expect(f.subscription.status).toBe("active");
    expect(preflightRenewalReplacement(f.preflightInput)).toMatchObject({
      status: "unsupported",
      reason: expect.stringMatching(/trial/i),
    });
  },
);

it("requires explicit no-current-trial evidence instead of inventing null for a missing item field", () => {
  const f = fixture({ omitItemCurrentTrial: true });
  expect(f.originalItem).not.toHaveProperty("current_trial");
  expect(preflightRenewalReplacement(f.preflightInput)).toMatchObject({
    status: "unsupported",
    reason: expect.stringMatching(/trial/i),
  });
});

it.each([
  {
    name: "disabled automatic tax",
    subscription: {
      automatic_tax: {
        enabled: false,
        liability: null,
        disabled_reason: "requires_location_inputs",
      },
    },
  },
  {
    name: "unknown liability",
    subscription: { automatic_tax: automatic({ type: "future_owner" }) },
  },
  {
    name: "foreign payment method",
    subscription: {
      default_payment_method: {
        id: "pm_foreign",
        object: "payment_method",
        customer: "cus_foreign",
        livemode: false,
      },
    },
  },
  {
    name: "malformed invoice issuer",
    subscription: {
      invoice_settings: {
        account_tax_ids: null,
        custom_fields: null,
        description: null,
        footer: null,
        issuer: { type: "future_issuer" },
      },
    },
  },
  {
    name: "invalid transfer precision",
    subscription: {
      transfer_data: {
        destination: "acct_destination",
        amount_percent: 12.345,
      },
    },
  },
  {
    name: "deleted routing account",
    subscription: {
      on_behalf_of: {
        id: "acct_issuer",
        object: "account",
        deleted: true,
      },
    },
  },
  {
    name: "automatic plus subscription manual tax",
    subscription: {
      automatic_tax: automatic(),
      default_tax_rates: [rate("txr_manual")],
    },
  },
  {
    name: "automatic plus item manual tax",
    subscription: { automatic_tax: automatic() },
    item: { tax_rates: [rate("txr_manual")] },
  },
  {
    name: "unproven subscription tax inheritance",
    subscription: { default_tax_rates: null },
  },
  {
    name: "unproven item tax inheritance",
    subscription: {},
    item: { tax_rates: null },
  },
  {
    name: "invoice due days under automatic collection",
    subscription: { days_until_due: 3 },
  },
  {
    name: "unknown collection method",
    subscription: { collection_method: "future_collection" },
  },
])(
  "rejects knowable original billing facts before attach: $name",
  (options) => {
    const result = preflightRenewalReplacement(fixture(options).preflightInput);
    expect(result).toMatchObject({
      status: "unsupported",
      reason: expect.any(String),
    });
  },
);

it("accepts mappable original routing, payment and manual-tax facts without an invented phase", () => {
  const f = fixture({
    subscription: {
      default_payment_method: {
        id: "pm_owned",
        object: "payment_method",
        customer: "cus_buyer",
        livemode: false,
      },
      on_behalf_of: "acct_issuer",
      transfer_data: { destination: "acct_destination", amount_percent: 0 },
      default_tax_rates: [rate("txr_original")],
    },
  });
  expect(preflightRenewalReplacement(f.preflightInput)).toMatchObject({
    status: "preflighted_for_projection",
    providerQualification: "required",
  });
});

it.each([
  {
    name: "different phase rates",
    subscription: { default_tax_rates: [rate("txr_original")] },
    phase: { default_tax_rates: [rate("txr_other")] },
  },
  {
    name: "different item rates",
    item: { tax_rates: [rate("txr_original")] },
    phaseItem: { tax_rates: [rate("txr_other")] },
  },
  {
    name: "new item override with the same current effective rate",
    subscription: { default_tax_rates: [rate("txr_original")] },
    phase: { default_tax_rates: [rate("txr_original")] },
    phaseItem: { tax_rates: [rate("txr_original")] },
  },
  {
    name: "removed item override with the same current effective rate",
    subscription: { default_tax_rates: [rate("txr_original")] },
    item: { tax_rates: [rate("txr_original")] },
    phase: { default_tax_rates: [rate("txr_original")] },
  },
  {
    name: "changed ordered phase rates",
    subscription: {
      default_tax_rates: [rate("txr_first"), rate("txr_second")],
    },
    phase: { default_tax_rates: [rate("txr_second"), rate("txr_first")] },
  },
  {
    name: "unproven null phase tax hierarchy",
    phase: { default_tax_rates: null },
  },
  { name: "unproven null phase item override", phaseItem: { tax_rates: null } },
])("retains exact tax values and override level: $name", (options) => {
  expect(
    projectRenewalConfiguration(fixture(options).configureInput),
  ).toMatchObject({
    status: "attached_unconfigured",
    reason: expect.stringMatching(/tax/i),
  });
});

it("preserves the subscription tax level and an empty item fallback", () => {
  const f = fixture({
    subscription: { default_tax_rates: [rate("txr_original")] },
    phase: { default_tax_rates: [rate("txr_original")] },
  });
  const result = projectRenewalConfiguration(f.configureInput);
  expect(result).toMatchObject({
    status: "projected_configure_request",
    payload: {
      phases: [
        { default_tax_rates: ["txr_original"], items: [{ tax_rates: "" }] },
        { default_tax_rates: ["txr_original"], items: [{ tax_rates: "" }] },
      ],
    },
  });
});

it("preserves an explicit item override separately from phase default rates", () => {
  const f = fixture({
    subscription: { default_tax_rates: [rate("txr_phase")] },
    item: { tax_rates: [rate("txr_item")] },
    phase: { default_tax_rates: [rate("txr_phase")] },
    phaseItem: { tax_rates: [rate("txr_item")] },
  });
  expect(projectRenewalConfiguration(f.configureInput)).toMatchObject({
    status: "projected_configure_request",
    payload: {
      phases: [
        {
          default_tax_rates: ["txr_phase"],
          items: [{ tax_rates: ["txr_item"] }],
        },
        {
          default_tax_rates: ["txr_phase"],
          items: [{ tax_rates: ["txr_item"] }],
        },
      ],
    },
  });
});
