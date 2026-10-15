import { expect, it } from "vitest";
import { formatRefundAmount, groupRefundPreview } from "./refund-preview.js";

it("isolates loaded amounts by currency and provider status", () => {
  expect(
    groupRefundPreview([
      { amount: 100, currency: "USD", status: "succeeded" },
      { amount: 250, currency: "usd", status: "succeeded" },
      { amount: 500, currency: "jpy", status: "succeeded" },
      { amount: 200, currency: "eur", status: "pending" },
      { amount: 300, currency: "jpy", status: "failed" },
      { amount: 400, currency: "usd", status: "canceled" },
    ]),
  ).toEqual([
    { currency: "usd", status: "succeeded", amount: 350, count: 2 },
    { currency: "jpy", status: "succeeded", amount: 500, count: 1 },
    { currency: "eur", status: "pending", amount: 200, count: 1 },
    { currency: "jpy", status: "failed", amount: 300, count: 1 },
    { currency: "usd", status: "canceled", amount: 400, count: 1 },
  ]);
});

it("keeps empty separate from recorded zero and fails closed on invalid/unsafe groups", () => {
  expect(groupRefundPreview([])).toEqual([]);
  expect(
    groupRefundPreview([{ amount: 0, currency: "usd", status: "succeeded" }])[0]
      ?.amount,
  ).toBe(0);
  for (const amount of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(
      groupRefundPreview([{ amount, currency: "usd", status: "succeeded" }])[0]
        ?.amount,
    ).toBeNull();
  }
  expect(
    groupRefundPreview([
      { amount: Number.MAX_SAFE_INTEGER, currency: "usd", status: "succeeded" },
      { amount: 1, currency: "usd", status: "succeeded" },
    ])[0]?.amount,
  ).toBeNull();
  expect(
    groupRefundPreview([{ amount: 100, currency: "zzz", status: "pending" }])[0]
      ?.amount,
  ).toBeNull();
});

it.each([
  [500, "jpy", "¥500"],
  [500, "mga", "MGA\u00a0500"],
  [50000, "isk", "ISK\u00a0500"],
  [101, "ugx", "UGX\u00a01.01"],
  [1045, "huf", "HUF\u00a010.45"],
  [0, "usd", "$0.00"],
])(
  "formats observed original refund units %s %s",
  (amount, currency, expected) => {
    expect(formatRefundAmount(amount, currency)).toBe(expected);
  },
);

it("does not throw for unknown currency or invalid observed amounts", () => {
  expect(formatRefundAmount(100, "zzz")).toBeNull();
  expect(formatRefundAmount(-1, "usd")).toBeNull();
  expect(formatRefundAmount(1.5, "jpy")).toBeNull();
});
