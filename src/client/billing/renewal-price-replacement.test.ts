import { expect, it } from "vitest";
import * as sdk from "../index.js";

const expected = {
  customerAccountId: "acct_buyer",
  subscriptionId: "sub_original",
  itemId: "si_original",
  currentPriceId: "price_original",
  currentProductId: "prod_original",
  targetPriceId: "price_target",
  targetProductId: "prod_other",
  periodStart: 1700000000,
  periodEnd: 1702592000,
  livemode: false,
};

it.each(["current", "target"] as const)(
  "accepts provider-valid custom %s product IDs",
  (which) => {
    const args = structuredClone(input());
    if (which === "current") {
      args.expected.currentProductId = "custom-original-catalog-item";
      args.subscription.items.data[0].price.product =
        args.expected.currentProductId;
    } else {
      args.expected.targetProductId = "custom-target-catalog-item";
      args.targetPrice.product = args.expected.targetProductId;
    }
    expect(sdk.prepareRenewalPriceReplacement(args).status).toBe("prepared");
  },
);
function price(id = "price_original", product = "prod_original") {
  return {
    id,
    product,
    object: "price",
    active: true,
    livemode: false,
    type: "recurring",
    currency: "usd",
    billing_scheme: "per_unit",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  };
}
function input() {
  return {
    expected,
    key: "renewal:original-operation",
    subscription: {
      id: "sub_original",
      object: "subscription",
      customer_account: "acct_buyer",
      status: "active",
      currency: "usd",
      livemode: false,
      schedule: null,
      cancel_at: null,
      cancel_at_period_end: false,
      pause_collection: null,
      pending_update: null,
      default_source: null,
      payment_settings: {
        payment_method_options: null,
        payment_method_types: null,
        save_default_payment_method: "off",
      },
      application_fee_percent: null,
      trial_end: 1690000000,
      items: {
        has_more: false,
        data: [
          {
            id: "si_original",
            object: "subscription_item",
            subscription: "sub_original",
            current_period_start: expected.periodStart,
            current_period_end: expected.periodEnd,
            quantity: 3,
            price: price(),
          },
        ],
      },
      metadata: { original: "keep" },
    },
    targetPrice: price("price_target", "prod_other"),
  };
}

it("accepts an undeleted expanded custom product reference", () => {
  const args = structuredClone(input());
  args.expected.targetProductId = "custom-target";
  expect(
    sdk.prepareRenewalPriceReplacement({
      ...args,
      targetPrice: {
        ...args.targetPrice,
        product: { id: "custom-target", object: "product" },
      },
    }).status,
  ).toBe("prepared");
});

it.each(["coupon", "customer"])(
  "rejects a wrong expanded product object %s",
  (object) => {
    const args = input();
    expect(() =>
      sdk.prepareRenewalPriceReplacement({
        ...args,
        targetPrice: {
          ...args.targetPrice,
          product: { id: args.expected.targetProductId, object },
        },
      }),
    ).toThrow();
  },
);

it("exports read-only renewal preparation without exposing a schedule writer", () => {
  expect(sdk).toHaveProperty(
    "prepareRenewalPriceReplacement",
    expect.any(Function),
  );
});

it("prepares an exact cross-product renewal snapshot without changing the paid item", () => {
  const args = input();
  const before = structuredClone(args);
  const result = sdk.prepareRenewalPriceReplacement(args);
  expect(result).toMatchObject({
    version: 1,
    status: "prepared",
    scope: "platform",
    expected,
    quantity: 3,
    requestIdentity: { key: args.key, binding: expect.any(String) },
    preservation: "requires_schedule_validation",
  });
  expect(result.providerSnapshot.subscription.items.data[0].price.id).toBe(
    "price_original",
  );
  expect(result.providerSnapshot.targetPrice.id).toBe("price_target");
  expect(args).toEqual(before);
  args.subscription.metadata.original = "changed after preparation";
  expect(result.providerSnapshot.subscription).toMatchObject({
    metadata: { original: "keep" },
  });
});

it("binds material source settings and complete target data with stable object ordering", () => {
  const args = input();
  const first = sdk.prepareRenewalPriceReplacement(args);
  const reordered = {
    ...args,
    subscription: Object.fromEntries(
      Object.entries(args.subscription).reverse(),
    ),
  };
  expect(sdk.prepareRenewalPriceReplacement(reordered).requestIdentity).toEqual(
    first.requestIdentity,
  );
  args.subscription.metadata.original = "different";
  expect(
    sdk.prepareRenewalPriceReplacement(args).requestIdentity.binding,
  ).not.toBe(first.requestIdentity.binding);
  args.targetPrice.recurring.interval_count = 2;
  expect(
    sdk.prepareRenewalPriceReplacement(args).requestIdentity.binding,
  ).not.toBe(first.requestIdentity.binding);
});

it.each([
  ["customerAccountId", "acct_foreign"],
  ["subscriptionId", "sub_foreign"],
  ["itemId", "si_foreign"],
  ["currentPriceId", "price_foreign"],
  ["currentProductId", "prod_foreign"],
  ["targetPriceId", "price_foreign"],
  ["targetProductId", "prod_foreign"],
  ["periodStart", 1699999999],
  ["periodEnd", 1702592001],
  ["livemode", true],
] as const)(
  "rejects a mismatched original/target selector %s",
  (field, value) => {
    const args = input();
    expect(() =>
      sdk.prepareRenewalPriceReplacement({
        ...args,
        expected: { ...expected, [field]: value },
      }),
    ).toThrow();
  },
);

it.each([
  ["schedule", "sub_sched_unrelated"],
  ["cancel_at_period_end", true],
  ["cancel_at", expected.periodEnd + 100],
  ["pause_collection", { behavior: "void" }],
  ["pending_update", {}],
  ["default_source", "card_legacy"],
  ["application_fee_percent", 0],
  ["status", "trialing"],
  ["payment_settings", { payment_method_types: ["card"] }],
] as const)(
  "rejects unsupported pre-attach state %s without a writer",
  (field, value) => {
    const args = input();
    expect(() =>
      sdk.prepareRenewalPriceReplacement({
        ...args,
        subscription: { ...args.subscription, [field]: value },
      }),
    ).toThrow();
  },
);

it("rejects incomplete/multi-item reads and an unexpanded original price", () => {
  const args = input();
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: {
        ...args.subscription,
        items: { ...args.subscription.items, has_more: true },
      },
    }),
  ).toThrow();
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: {
        ...args.subscription,
        items: {
          has_more: false,
          data: [
            ...args.subscription.items.data,
            ...args.subscription.items.data,
          ],
        },
      },
    }),
  ).toThrow();
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: {
        ...args.subscription,
        items: {
          has_more: false,
          data: [
            { ...args.subscription.items.data[0], price: "price_original" },
          ],
        },
      },
    }),
  ).toThrow();
});

it.each(["", " ", "bad\nkey", "a".repeat(256)])(
  "requires an explicit valid retained key %j",
  (key) => {
    expect(() =>
      sdk.prepareRenewalPriceReplacement({ ...input(), key }),
    ).toThrow();
  },
);

it("rejects an unexpected connected scope instead of silently assuming platform scope", () => {
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...input(),
      connectedAccountId: "acct_other",
    } as Parameters<typeof sdk.prepareRenewalPriceReplacement>[0]),
  ).toThrow(/Unrecognized|scope/);
});

it("rejects sparse JSON arrays instead of silently converting holes to null", () => {
  const args = input();
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: {
        ...args.subscription,
        metadata: { sparse: new Array(1) },
      },
    }),
  ).toThrow(/JSON/);
});

it("rejects enumerable accessors without executing them while copying provider data", () => {
  const args = input();
  let evaluated = false;
  Object.defineProperty(args.subscription, "metadata", {
    enumerable: true,
    get() {
      evaluated = true;
      return { original: "getter" };
    },
  });
  expect(() => sdk.prepareRenewalPriceReplacement(args)).toThrow(/JSON/);
  expect(evaluated).toBe(false);
});

it("accepts a full provider read with an empty billing_schedules list", () => {
  const args = input();
  expect(
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: { ...args.subscription, billing_schedules: [] },
    }).status,
  ).toBe("prepared");
});

it("retains a provider default-null payment setting without certifying preservation", () => {
  const args = input();
  expect(
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: {
        ...args.subscription,
        payment_settings: {
          ...args.subscription.payment_settings,
          save_default_payment_method: null,
        },
      },
    }),
  ).toMatchObject({
    preservation: "requires_schedule_validation",
    providerSnapshot: {
      subscription: { payment_settings: { save_default_payment_method: null } },
    },
  });
});

it("bounds array traversal before inspecting its elements", () => {
  const args = input();
  let inspected = 0;
  const large = Array.from({ length: 10_001 }, () => ({}));
  for (const value of large)
    Object.defineProperty(value, "data", {
      enumerable: true,
      get() {
        inspected++;
        return "x";
      },
    });
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: { ...args.subscription, metadata: { large } },
    }),
  ).toThrow(/too large|budget/);
  expect(inspected).toBe(0);
});

const billingCustomer = {
  id: "cus_buyer",
  object: "customer",
  customer_account: "acct_buyer",
  livemode: false,
  discount: null,
  invoice_settings: { default_payment_method: null },
};

it("binds the correlated billing-customer bridge without claiming discount hierarchy proof", () => {
  const args = input();
  const result = sdk.prepareRenewalPriceReplacement({
    ...args,
    subscription: { ...args.subscription, customer: "cus_buyer" },
    billingCustomer,
  });
  expect(result.providerSnapshot).toMatchObject({ billingCustomer });
  expect(result.preservation).toBe("requires_schedule_validation");
  const changed = sdk.prepareRenewalPriceReplacement({
    ...args,
    subscription: { ...args.subscription, customer: "cus_buyer" },
    billingCustomer: {
      ...billingCustomer,
      invoice_settings: { default_payment_method: "pm_changed" },
    },
  });
  expect(changed.requestIdentity.binding).not.toBe(
    result.requestIdentity.binding,
  );
});

it.each([
  ["id", "cus_foreign"],
  ["customer_account", "acct_foreign"],
  ["livemode", true],
  ["deleted", true],
] as const)(
  "rejects foreign/deleted billing-customer evidence %s",
  (field, value) => {
    const args = input();
    expect(() =>
      sdk.prepareRenewalPriceReplacement({
        ...args,
        subscription: { ...args.subscription, customer: "cus_buyer" },
        billingCustomer: { ...billingCustomer, [field]: value },
      }),
    ).toThrow();
  },
);

it("requires an explicit discount read in supplied ancestor evidence", () => {
  const args = input();
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: { ...args.subscription, customer: "cus_buyer" },
      billingCustomer: {
        id: "cus_buyer",
        object: "customer",
        customer_account: "acct_buyer",
        livemode: false,
      },
    }),
  ).toThrow();
});

it("accepts an expanded original customer and retains an expanded existing redemption as evidence only", () => {
  const args = input();
  const customer = {
    ...billingCustomer,
    discount: {
      id: "di_existing",
      object: "discount",
      start: 1690000000,
      end: null,
      source: {
        type: "coupon",
        coupon: { id: "coupon_existing", duration: "once" },
      },
    },
  };
  expect(
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: { ...args.subscription, customer: billingCustomer },
      billingCustomer: customer,
    }),
  ).toMatchObject({
    preservation: "requires_schedule_validation",
    providerSnapshot: { billingCustomer: customer },
  });
});

it("rejects a deleted expanded original customer even when the separate billing read matches its ID", () => {
  const args = input();
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: {
        ...args.subscription,
        customer: { ...billingCustomer, deleted: true },
      },
      billingCustomer,
    }),
  ).toThrow(/does not match/);
});

it.each([
  ["nonfinite", Number.POSITIVE_INFINITY],
  ["undefined", undefined],
  ["function", () => 1],
  ["bigint", 1n],
  ["symbol", Symbol("value")],
  ["class instance", new Date(0)],
  ["oversized string", "x".repeat(500_001)],
])("rejects %s in private provider JSON", (_label, value) => {
  const args = input();
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: { ...args.subscription, metadata: { value } },
    }),
  ).toThrow(/JSON/);
});

it("rejects a cyclic provider snapshot", () => {
  const args = input();
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: { ...args.subscription, metadata: cyclic },
    }),
  ).toThrow(/JSON/);
});

it("rejects an alternative subscription currency even when both default price currencies match", () => {
  const args = input();
  expect(() =>
    sdk.prepareRenewalPriceReplacement({
      ...args,
      subscription: { ...args.subscription, currency: "eur" },
    }),
  ).toThrow(/currency/);
});
