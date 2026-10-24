import { expect, it } from "vitest";

import * as sdk from "../index.js";

it("exports a pure captured Checkout payment qualifier from the public SDK", () => {
  expect(sdk).toHaveProperty(
    "qualifyCapturedCheckoutPayment",
    expect.any(Function),
  );
});

const expected = {
  stripeSessionId: "cs_original",
  customerAccountId: "acct_buyer",
  livemode: false,
};

function session() {
  return {
    id: "cs_original",
    object: "checkout.session",
    mode: "payment",
    subscription: null,
    status: "complete",
    payment_status: "paid",
    customer_account: "acct_buyer",
    livemode: false,
    amount_total: 3500,
    currency: "usd",
    metadata: { originalRequest: "host-request" },
    payment_intent: {
      id: "pi_original",
      object: "payment_intent",
      status: "succeeded",
      customer_account: "acct_buyer",
      livemode: false,
      amount: 3500,
      amount_received: 3500,
      currency: "usd",
      metadata: { originalPayment: "host-payment" },
      latest_charge: {
        id: "ch_original",
        object: "charge",
        payment_intent: "pi_original",
        livemode: false,
        status: "succeeded",
        paid: true,
        captured: true,
        amount: 3500,
        amount_captured: 3500,
        currency: "usd",
      },
    },
  };
}

function change(input: object, path: string, value: unknown) {
  const keys = path.split(".");
  let current = input as Record<string, unknown>;
  for (const key of keys.slice(0, -1))
    current = current[key] as Record<string, unknown>;
  current[keys[keys.length - 1]!] = value;
}

it("qualifies the retrieved original without invoice, fees or balance data", () => {
  const input = session();
  const before = structuredClone(input);
  expect(sdk.qualifyCapturedCheckoutPayment(input, expected)).toEqual({
    status: "ready",
    stripeSessionId: "cs_original",
    stripePaymentIntentId: "pi_original",
    stripeChargeId: "ch_original",
    customerAccountId: "acct_buyer",
    livemode: false,
    amount: 3500,
    currency: "usd",
    sessionMetadata: { originalRequest: "host-request" },
    paymentIntentMetadata: { originalPayment: "host-payment" },
  });
  expect(input).toEqual(before);
});

it.each([
  ["id", "cs_foreign"],
  ["object", "payment_intent"],
  ["mode", "subscription"],
  ["subscription", "sub_contradiction"],
  ["status", "open"],
  ["status", "expired"],
  ["status", null],
  ["payment_status", "unpaid"],
  ["payment_status", "no_payment_required"],
  ["payment_intent", "pi_original"],
  ["payment_intent", null],
  ["payment_intent.id", "bad"],
  ["payment_intent.object", "charge"],
  ["payment_intent.status", "processing"],
  ["payment_intent.status", "requires_capture"],
  ["payment_intent.status", "canceled"],
  ["payment_intent.latest_charge", "ch_original"],
  ["payment_intent.latest_charge", null],
  ["payment_intent.latest_charge.id", "bad"],
  ["payment_intent.latest_charge.object", "payment_intent"],
  ["payment_intent.latest_charge.payment_intent", "pi_foreign"],
  ["payment_intent.latest_charge.status", "failed"],
  ["payment_intent.latest_charge.paid", false],
  ["payment_intent.latest_charge.captured", false],
  ["customer_account", "acct_foreign"],
  ["customer_account", undefined],
  ["payment_intent.customer_account", "acct_foreign"],
  ["payment_intent.customer_account", undefined],
  ["livemode", true],
  ["payment_intent.livemode", true],
  ["payment_intent.latest_charge.livemode", true],
  ["currency", "USD"],
  ["currency", ""],
  ["payment_intent.currency", "eur"],
  ["payment_intent.latest_charge.currency", "eur"],
  ["metadata", { invalid: 1 }],
  ["payment_intent.metadata", { invalid: null }],
  ["amount_total", 3499],
  ["payment_intent.amount", 3499],
  ["payment_intent.amount_received", 3499],
  ["payment_intent.latest_charge.amount", 3499],
  ["payment_intent.latest_charge.amount_captured", 3499],
] as const)("withholds inconsistent or incomplete %s = %j", (path, value) => {
  const input = session();
  change(input, path, value);
  expect(sdk.qualifyCapturedCheckoutPayment(input, expected).status).toBe(
    "unavailable",
  );
});

it.each([null, undefined, {}, "session", []])(
  "rejects malformed input %j",
  (input) => {
    expect(sdk.qualifyCapturedCheckoutPayment(input, expected)).toEqual({
      status: "unavailable",
      reason: "invalid_evidence",
    });
  },
);

it.each(["stripeSessionId", "customerAccountId", "livemode"] as const)(
  "rejects malformed expected %s at runtime",
  (key) => {
    const input = { ...expected, [key]: null };
    expect(
      sdk.qualifyCapturedCheckoutPayment(session(), input as never),
    ).toEqual({
      status: "unavailable",
      reason: "invalid_context",
    });
  },
);

it.each(["", "bad", "cs_"])(
  "rejects malformed Session selector %j",
  (stripeSessionId) => {
    expect(
      sdk.qualifyCapturedCheckoutPayment(session(), {
        ...expected,
        stripeSessionId,
      }),
    ).toEqual({
      status: "unavailable",
      reason: "invalid_context",
    });
  },
);
it.each(["", "cus_buyer", "acct_"])(
  "rejects malformed V2 account selector %j",
  (customerAccountId) => {
    expect(
      sdk.qualifyCapturedCheckoutPayment(session(), {
        ...expected,
        customerAccountId,
      }),
    ).toEqual({
      status: "unavailable",
      reason: "invalid_context",
    });
  },
);

it("does not substitute customer-v1 presentation for V2 account authority", () => {
  const input = session();
  Object.assign(input, { customer: "cus_buyer", customer_account: undefined });
  Object.assign(input.payment_intent, {
    customer: "cus_buyer",
    customer_account: undefined,
  });
  expect(sdk.qualifyCapturedCheckoutPayment(input, expected).status).toBe(
    "unavailable",
  );
});

it("rejects coherent live evidence against expected test scope", () => {
  const input = session();
  input.livemode =
    input.payment_intent.livemode =
    input.payment_intent.latest_charge.livemode =
      true;
  expect(sdk.qualifyCapturedCheckoutPayment(input, expected)).toEqual({
    status: "unavailable",
    reason: "identity_mismatch",
  });
  expect(
    sdk.qualifyCapturedCheckoutPayment(input, { ...expected, livemode: true })
      .status,
  ).toBe("ready");
});

it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "3500"])(
  "rejects coherently invalid gross amount %j",
  (amount) => {
    const input = session();
    for (const path of [
      "amount_total",
      "payment_intent.amount",
      "payment_intent.amount_received",
      "payment_intent.latest_charge.amount",
      "payment_intent.latest_charge.amount_captured",
    ])
      change(input, path, amount);
    expect(sdk.qualifyCapturedCheckoutPayment(input, expected).status).toBe(
      "unavailable",
    );
  },
);

it.each([
  ["jpy", 3500],
  ["kwd", 3501],
  ["usd", Number.MAX_SAFE_INTEGER],
] as const)(
  "preserves integer original provider units for %s",
  (currency, amount) => {
    const input = session();
    input.currency =
      input.payment_intent.currency =
      input.payment_intent.latest_charge.currency =
        currency;
    input.amount_total =
      input.payment_intent.amount =
      input.payment_intent.amount_received =
      input.payment_intent.latest_charge.amount =
      input.payment_intent.latest_charge.amount_captured =
        amount;
    expect(sdk.qualifyCapturedCheckoutPayment(input, expected)).toMatchObject({
      status: "ready",
      amount,
      currency,
    });
  },
);

it("keeps captured history after refunds/disputes without asserting eligibility", () => {
  const input = session();
  Object.assign(input.payment_intent.latest_charge, {
    refunded: true,
    amount_refunded: 3500,
    disputed: true,
    balance_transaction: null,
    application_fee: null,
    invoice: null,
  });
  const result = sdk.qualifyCapturedCheckoutPayment(input, expected);
  expect(result).toMatchObject({ status: "ready", amount: 3500 });
  expect(result).not.toHaveProperty("refundable");
  expect(result).not.toHaveProperty("payable");
});
