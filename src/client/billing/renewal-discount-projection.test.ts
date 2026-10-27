import { expect, it } from "vitest";
import * as projection from "./renewalProjection/discounts.js";

const context = {
  customerAccountId: "acct_buyer",
  subscriptionId: "sub_original",
  level: "subscription" as const,
  currentProductId: "prod_original",
  targetProductId: "prod_target",
};
function redemption() {
  return {
    id: "di_existing",
    object: "discount",
    customer_account: "acct_buyer",
    subscription: "sub_original",
    subscription_item: null,
    start: 1700000000,
    end: null,
    source: {
      type: "coupon",
      coupon: {
        id: "original-offer",
        object: "coupon",
        duration: "forever",
        applies_to: { products: ["prod_original", "prod_target"] },
      },
    },
  };
}
function input() {
  return {
    ...context,
    redemptions: [redemption()],
    phaseDiscounts: [
      {
        discount: "di_existing",
        coupon: "original-offer",
        promotion_code: null,
      },
    ],
  };
}

it("defines a pure discount projection boundary", () => {
  expect(projection).toHaveProperty(
    "projectRenewalDiscounts",
    expect.any(Function),
  );
});

it("reuses an existing unambiguous forever redemption without redeeming a coupon", () => {
  const args = input();
  const before = structuredClone(args);
  expect(projection.projectRenewalDiscounts(args)).toEqual({
    status: "projected",
    discounts: [{ discount: "di_existing" }],
    requiresProviderQualification: true,
  });
  expect(args).toEqual(before);
});

it("does not reinterpret an empty phase as customer inheritance or suppression", () => {
  expect(
    projection.projectRenewalDiscounts({
      ...context,
      redemptions: [],
      phaseDiscounts: [],
    }),
  ).toEqual({
    status: "unsupported",
    reason: "ambiguous_empty_discount_hierarchy",
  });
});

it.each([
  ["customer_account", "acct_foreign"],
  ["subscription", "sub_foreign"],
  ["subscription_item", "si_other"],
  ["deleted", true],
] as const)(
  "rejects foreign or incomplete redemption identity %s",
  (field, value) => {
    const args = input();
    expect(
      projection.projectRenewalDiscounts({
        ...args,
        redemptions: [{ ...redemption(), [field]: value }],
      }).status,
    ).toBe("unsupported");
  },
);

it.each(["once", "repeating"])(
  "keeps unqualified %s duration visible",
  (duration) => {
    const args = input();
    const discount = redemption();
    discount.source.coupon.duration = duration;
    expect(
      projection.projectRenewalDiscounts({ ...args, redemptions: [discount] }),
    ).toEqual({
      status: "unsupported",
      reason: "discount_duration_not_qualified",
    });
  },
);

it("rejects cross-product applicability gaps", () => {
  const args = input();
  args.redemptions[0].source.coupon.applies_to.products = ["prod_original"];
  expect(projection.projectRenewalDiscounts(args)).toEqual({
    status: "unsupported",
    reason: "coupon_product_applicability",
  });
});

it("requires the phase to identify the same acknowledged redemption, in order", () => {
  const args = input();
  args.phaseDiscounts[0].discount = "di_foreign";
  expect(projection.projectRenewalDiscounts(args)).toEqual({
    status: "unsupported",
    reason: "phase_redemption_mismatch",
  });
});

it("never turns an unexpanded ID into invented redemption evidence", () => {
  expect(
    projection.projectRenewalDiscounts({
      ...input(),
      redemptions: ["di_existing"],
    }),
  ).toEqual({ status: "unsupported", reason: "incomplete_discount_evidence" });
});

it.each([
  ["id", "coupon_wrong_kind"],
  ["customer_account", "cus_wrong_kind"],
  ["subscription", "si_wrong_kind"],
  ["subscription_item", "sub_wrong_kind"],
  ["id", "   "],
] as const)("rejects malformed redemption %s", (field, value) => {
  const args = input();
  const discount = { ...redemption(), [field]: value };
  const result = projection.projectRenewalDiscounts({
    ...args,
    customerAccountId: discount.customer_account,
    subscriptionId: discount.subscription,
    redemptions: [discount],
    phaseDiscounts: [{ discount: discount.id }],
  });
  expect(result).toEqual({
    status: "unsupported",
    reason: "incomplete_discount_evidence",
  });
});

it.each(["currentProductId", "targetProductId"] as const)(
  "rejects blank custom product identity %s",
  (field) => {
    const args = input();
    args.redemptions[0].source.coupon.applies_to.products.push(" ");
    expect(
      projection.projectRenewalDiscounts({ ...args, [field]: " " }),
    ).toEqual({
      status: "unsupported",
      reason: "incomplete_discount_evidence",
    });
  },
);

it("preserves custom product and coupon IDs", () => {
  const args = input();
  args.currentProductId = "custom-original";
  args.targetProductId = "custom-target";
  args.redemptions[0].source.coupon.applies_to.products = [
    args.currentProductId,
    args.targetProductId,
  ];
  expect(projection.projectRenewalDiscounts(args).status).toBe("projected");
});

it.each([
  { customer_account: "acct_foreign" },
  { subscription: "sub_foreign" },
  { source: { type: "coupon", coupon: { id: "foreign-offer" } } },
])("rejects additional expanded phase claims %j", (extra) => {
  expect(
    projection.projectRenewalDiscounts({
      ...input(),
      phaseDiscounts: [
        {
          discount: { id: "di_existing", object: "discount", ...extra },
        },
      ],
    }),
  ).toEqual({ status: "unsupported", reason: "incomplete_discount_evidence" });
});

it("accepts a minimal phase discount reference", () => {
  expect(
    projection.projectRenewalDiscounts({
      ...input(),
      phaseDiscounts: [{ discount: { id: "di_existing", object: "discount" } }],
    }).status,
  ).toBe("projected");
});
