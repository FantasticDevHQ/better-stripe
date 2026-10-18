import { expect, it } from "vitest";
import { runMeteringSandbox } from "./metering-sandbox.mjs";

it.each([undefined, "sk_live_invalid"])(
  "blocks non-test keys before creating resources",
  async (apiKey) => {
    let calls = 0;
    await expect(
      runMeteringSandbox({
        apiKey,
        createClient: () => {
          calls++;
        },
      }),
    ).rejects.toThrow("test-mode");
    expect(calls).toBe(0);
  },
);

it("probes all three models with provider-mapped payer identity and sanitized evidence", async () => {
  const calls = [];
  const method =
    (name, result) =>
    async (...args) => {
      calls.push({ name, args });
      return typeof result === "function" ? result(...args) : result;
    };
  const stripe = {
    v2: {
      core: {
        accounts: {
          create: method("account.create", {
            id: "acct_private",
            livemode: false,
          }),
        },
      },
    },
    customers: {
      retrieve: method("customer.retrieve", {
        id: "cus_private",
        customer_account: "acct_private",
        livemode: false,
      }),
    },
    products: {
      create: method("product.create", { id: "prod_private", livemode: false }),
      update: method("product.update", {}),
    },
    prices: {
      create: method("price.create", { id: "price_private", livemode: false }),
      update: method("price.update", {}),
    },
    subscriptions: {
      create: method("subscription.create", {
        id: "sub_private",
        customer_account: "acct_private",
        customer: "cus_private",
        livemode: false,
      }),
      cancel: method("subscription.cancel", {}),
    },
    invoices: {
      createPreview: method("preview", {
        customer_account: "acct_private",
        currency: "usd",
        total: 0,
        livemode: false,
      }),
    },
    billing: {
      meters: {
        create: method("meter.create", { id: "mtr_private", livemode: false }),
        deactivate: method("meter.deactivate", {}),
        listEventSummaries: method("summaries", {
          data: [{ aggregated_value: 15 }],
        }),
      },
      meterEvents: {
        create: method("event.create", {
          livemode: false,
          identifier: "event_private",
        }),
      },
      creditGrants: {
        create: method("credit.create", {
          id: "cred_private",
          customer_account: "acct_private",
          livemode: false,
        }),
        expire: method("credit.expire", {}),
      },
    },
  };
  const result = await runMeteringSandbox({
    apiKey: "sk_test_fixture",
    runId: "fixture",
    createClient: () => stripe,
  });
  expect(
    calls.find((x) => x.name === "account.create").args[0].contact_email,
  ).toBe("metering-fixture@example.invalid");
  expect(result.models.map((x) => x.model)).toEqual([
    "pay_as_you_go",
    "included_overage",
    "prepaid",
  ]);
  expect(result.models.every((x) => x.invoiceIdentityVerified)).toBe(true);
  expect(result.models.every((x) => x.aggregationVerified)).toBe(true);
  expect(calls.filter((x) => x.name === "event.create")).toHaveLength(6);
  expect(result.models.every((x) => x.paymentVerified === false)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/private|sk_test_fixture/);
  expect(
    calls
      .filter((x) => x.name === "subscription.create")
      .every((x) => x.args[0].collection_method === "send_invoice"),
  ).toBe(true);
  expect(
    calls
      .filter((x) => x.name === "event.create")
      .every((x) => x.args[0].payload.stripe_customer_id === "cus_private"),
  ).toBe(true);
  expect(calls.find((x) => x.name === "credit.create").args[0]).toMatchObject({
    category: "promotional",
    customer_account: "acct_private",
  });
  expect(calls.filter((x) => x.name === "subscription.cancel")).toHaveLength(3);
  expect(calls.filter((x) => x.name === "meter.deactivate")).toHaveLength(3);
  expect(
    calls.filter((x) => x.name === "price.create")[1].args[0],
  ).toMatchObject({
    billing_scheme: "tiered",
    tiers_mode: "graduated",
    tiers: [
      { up_to: 10, unit_amount: 0 },
      { up_to: "inf", unit_amount: 2 },
    ],
  });
});

it("rejects a payer mapping mismatch before catalog or usage writes", async () => {
  let writes = 0;
  const stripe = {
    v2: {
      core: {
        accounts: {
          create: async () => ({ id: "acct_expected", livemode: false }),
        },
      },
    },
    customers: {
      retrieve: async () => ({
        id: "cus_private",
        customer_account: "acct_foreign",
        livemode: false,
      }),
    },
    products: {
      create: async () => {
        writes++;
      },
    },
  };
  await expect(
    runMeteringSandbox({
      apiKey: "sk_test_fixture",
      runId: "fixture",
      createClient: () => stripe,
    }),
  ).rejects.toThrow("payer mapping");
  expect(writes).toBe(0);
});

it("reports allowlisted provider error classification without its message or payload", async () => {
  const failure = Object.assign(new Error("private provider payload"), {
    statusCode: 400,
    code: "parameter_invalid",
    param: "collection_method",
  });
  const stripe = {
    v2: {
      core: {
        accounts: {
          create: async () => {
            throw failure;
          },
        },
      },
    },
  };
  await expect(
    runMeteringSandbox({
      apiKey: "sk_test_fixture",
      runId: "fixture",
      createClient: () => stripe,
    }),
  ).rejects.toThrow("parameter_invalid:collection_method");
});

it("never grants purchased credits for an unverified payment", async () => {
  let granted = false;
  const stripe = {
    v2: {
      core: {
        accounts: {
          create: async () => ({ id: "acct_fixture", livemode: false }),
        },
      },
    },
    customers: {
      retrieve: async () => ({
        id: "cus_fixture",
        customer_account: "acct_fixture",
        livemode: false,
      }),
    },
    products: {
      create: async () => ({ id: "prod_fixture", livemode: false }),
      update: async () => ({}),
    },
    prices: {
      create: async () => ({ id: "price_fixture", livemode: false }),
      update: async () => ({}),
    },
    subscriptions: {
      create: async () => ({
        id: "sub_fixture",
        customer: "cus_fixture",
        customer_account: "acct_fixture",
        livemode: false,
      }),
      cancel: async () => ({}),
    },
    paymentIntents: {
      create: async () => ({
        id: "pi_fixture",
        status: "processing",
        livemode: false,
        customer_account: "acct_fixture",
        amount: 100,
        currency: "usd",
      }),
    },
    billing: {
      meters: {
        create: async () => ({ id: "mtr_fixture", livemode: false }),
        deactivate: async () => ({}),
        listEventSummaries: async () => ({ data: [{ aggregated_value: 15 }] }),
      },
      meterEvents: { create: async () => ({ livemode: false }) },
      creditGrants: {
        create: async () => {
          granted = true;
          return {
            id: "cred_fixture",
            livemode: false,
            customer_account: "acct_fixture",
          };
        },
        expire: async () => ({}),
      },
    },
    invoices: {
      createPreview: async () => ({
        customer_account: "acct_fixture",
        livemode: false,
        total: 0,
        currency: "usd",
      }),
    },
  };
  await expect(
    runMeteringSandbox({
      apiKey: "sk_test_fixture",
      runId: "fixture",
      verifyPayments: true,
      createClient: () => stripe,
    }),
  ).rejects.toThrow("prepaid:payment");
  expect(granted).toBe(false);
  let refunded = false;
  stripe.paymentIntents.create = async (params) => {
    expect(params.allowed_payment_method_types).toEqual(["card"]);
    expect(params).not.toHaveProperty("payment_method_types");
    return {
      id: "pi_fixture",
      status: "succeeded",
      livemode: false,
      customer_account: "acct_fixture",
      amount_received: 100,
      currency: "usd",
    };
  };
  stripe.refunds = {
    create: async () => {
      refunded = true;
      return {};
    },
  };
  const grant = stripe.billing.creditGrants.create;
  stripe.billing.creditGrants.create = async (params) => {
    expect(params.category).toBe("paid");
    expect(params.metadata.feasibilityPaymentIntent).toBe("pi_fixture");
    return grant();
  };
  const result = await runMeteringSandbox({
    apiKey: "sk_test_fixture",
    runId: "paymentfixture",
    verifyPayments: true,
    createClient: () => stripe,
  });
  expect(
    result.models.find((row) => row.model === "prepaid").creditPurchaseVerified,
  ).toBe(true);
  expect(granted).toBe(true);
  expect(refunded).toBe(true);
});

it("bounds the run identity before creating a provider client", async () => {
  let calls = 0;
  await expect(
    runMeteringSandbox({
      apiKey: "sk_test_fixture",
      runId: "invalid/identity",
      createClient: () => {
        calls++;
      },
    }),
  ).rejects.toThrow("run identity");
  expect(calls).toBe(0);
});
