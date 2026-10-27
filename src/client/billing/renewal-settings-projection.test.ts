import { expect, it } from "vitest";
import * as projection from "./renewalProjection/settings.js";

const context = {
  customerAccountId: "acct_buyer",
  customerId: "cus_buyer",
  livemode: false,
  effectiveCollectionMethod: "charge_automatically",
  effectiveAutomaticTax: false,
  effectiveInvoiceIssuer: { type: "self" },
};
function settings() {
  return {
    application_fee_percent: null,
    billing_thresholds: null,
    collection_method: null,
    default_payment_method: null,
    on_behalf_of: null,
    transfer_data: null,
    automatic_tax: { enabled: false, liability: null, disabled_reason: null },
    default_tax_rates: [],
    invoice_settings: {
      account_tax_ids: null,
      custom_fields: null,
      days_until_due: null,
      description: null,
      footer: null,
      issuer: null,
    },
    description: null,
    metadata: null,
  };
}
const project = (value: unknown) =>
  projection.projectRenewalPhaseSettings({
    context,
    settings: value,
  });

it("maps disabled tax and explicit empty rates without inventing null writes", () => {
  expect(project(settings())).toEqual({
    status: "projected",
    settings: { automatic_tax: { enabled: false }, default_tax_rates: "" },
    requiresProviderQualification: true,
  });
});

it("maps exact routing, descriptions and nonempty metadata without mutating reads", () => {
  const value = {
    ...settings(),
    on_behalf_of: { id: "acct_issuer", object: "account" },
    transfer_data: { destination: "acct_destination", amount_percent: 0 },
    description: "",
    metadata: { original: "retained" },
  };
  const before = structuredClone(value);
  expect(project(value)).toMatchObject({
    status: "projected",
    settings: {
      on_behalf_of: "acct_issuer",
      transfer_data: { destination: "acct_destination", amount_percent: 0 },
      description: "",
      metadata: { original: "retained" },
    },
  });
  expect(value).toEqual(before);
});

it("omits a null transfer percentage rather than fabricating full-transfer values", () => {
  expect(
    project({
      ...settings(),
      transfer_data: {
        destination: "acct_destination",
        amount_percent: null,
      },
    }),
  ).toMatchObject({
    status: "projected",
    settings: {
      transfer_data: { destination: "acct_destination" },
    },
  });
});

it.each([
  { application_fee_percent: 0 },
  { billing_thresholds: { amount_gte: 100 } },
  { collection_method: "future_mode" },
  { on_behalf_of: { id: "acct_issuer", object: "account", deleted: true } },
  {
    default_payment_method: {
      id: "pm_existing",
      object: "payment_method",
      customer: "cus_foreign",
    },
  },
  {
    automatic_tax: {
      enabled: false,
      disabled_reason: "requires_location_inputs",
    },
  },
  {
    automatic_tax: {
      enabled: true,
      liability: { type: "account", account: null },
    },
  },
  { metadata: { remove: "" } },
  { future_setting: true },
])("rejects incomplete or unqualified settings %j", (extra) => {
  expect(project({ ...settings(), ...extra }).status).toBe("unsupported");
});

it("rejects manual tax alongside enabled automatic tax", () => {
  expect(
    project({
      ...settings(),
      automatic_tax: { enabled: true },
      default_tax_rates: [
        { id: "txr_existing", object: "tax_rate", livemode: false },
      ],
    }).status,
  ).toBe("unsupported");
});

it("rejects manual tax inherited alongside automatic tax from unchanged defaults", () => {
  const value = settings();
  const { automatic_tax: _, ...rest } = value;
  expect(
    projection.projectRenewalPhaseSettings({
      context: { ...context, effectiveAutomaticTax: true },
      settings: {
        ...rest,
        default_tax_rates: [
          { id: "txr_existing", object: "tax_rate", livemode: false },
        ],
      },
    }).status,
  ).toBe("unsupported");
});

it("maps account tax liability and preserves invoice tax IDs in order", () => {
  const value = settings();
  expect(
    projection.projectRenewalPhaseSettings({
      context: { ...context, effectiveAutomaticTax: true },
      settings: {
        ...value,
        automatic_tax: {
          enabled: true,
          liability: { type: "account", account: "acct_liable" },
        },
        invoice_settings: {
          ...value.invoice_settings,
          account_tax_ids: [
            {
              id: "txi_first",
              object: "tax_id",
              livemode: false,
              customer: null,
              customer_account: null,
              owner: { type: "self", customer_account: null },
            },
            "txi_second",
          ],
        },
      },
    }),
  ).toMatchObject({
    status: "projected",
    settings: {
      automatic_tax: {
        enabled: true,
        liability: { type: "account", account: "acct_liable" },
      },
      invoice_settings: { account_tax_ids: ["txi_first", "txi_second"] },
    },
  });
});

it("rejects a tax reference from the wrong mode", () => {
  expect(
    project({
      ...settings(),
      default_tax_rates: [
        { id: "txr_live", object: "tax_rate", livemode: true },
      ],
    }).status,
  ).toBe("unsupported");
});

it.each([{ livemode: true }, { customer_account: "acct_foreign" }])(
  "rejects contradictory nested payment-method customer facts %j",
  (extra) => {
    expect(
      project({
        ...settings(),
        default_payment_method: {
          id: "pm_existing",
          object: "payment_method",
          livemode: false,
          customer: { id: "cus_buyer", object: "customer", ...extra },
        },
      }).status,
    ).toBe("unsupported");
  },
);

it.each([
  undefined,
  { type: "account", account: "acct_foreign", customer_account: null },
  { type: "customer", customer: "cus_buyer", customer_account: "acct_buyer" },
])("rejects unqualified invoice tax ownership %j", (owner) => {
  const value = settings();
  const tax = {
    id: "txi_existing",
    object: "tax_id",
    livemode: false,
    ...(owner === undefined ? {} : { owner }),
  };
  expect(
    project({
      ...value,
      invoice_settings: {
        ...value.invoice_settings,
        account_tax_ids: [tax],
      },
    }).status,
  ).toBe("unsupported");
});

it("maps invoice Emptyables, an explicit issuer and zero-day send_invoice terms", () => {
  expect(
    projection.projectRenewalPhaseSettings({
      context: { ...context, effectiveCollectionMethod: "send_invoice" },
      settings: {
        ...settings(),
        collection_method: "send_invoice",
        invoice_settings: {
          account_tax_ids: [],
          custom_fields: [],
          days_until_due: 0,
          description: "",
          footer: "original footer",
          issuer: { type: "self" },
        },
      },
    }),
  ).toMatchObject({
    status: "projected",
    settings: {
      invoice_settings: {
        account_tax_ids: "",
        custom_fields: "",
        days_until_due: 0,
        description: "",
        footer: "original footer",
        issuer: { type: "self" },
      },
    },
  });
});

it("rejects due days for charge_automatically", () => {
  const value = settings();
  expect(
    project({
      ...value,
      invoice_settings: {
        ...value.invoice_settings,
        days_until_due: 3,
      },
    }).status,
  ).toBe("unsupported");
});
