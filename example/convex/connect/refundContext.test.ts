import { afterEach, expect, it, vi } from "vitest";
import { stripe } from "../stripe/helpers";
import * as reference from "./refundContext";

const options = { stripePaymentIntentId: "pi_sale", maxRefundPages: 2 };
const result = { status: "unavailable", reason: "refund_pending" } as const;
const mapping = { userId: "seller", stripeAccountId: "acct_seller" };
function setup(
  account: object | null = mapping,
  payment: object | null = { destinationAccountId: "acct_seller" },
) {
  const runQuery = vi
    .fn()
    .mockResolvedValueOnce(account)
    .mockResolvedValueOnce(payment);
  const read = vi.spyOn(stripe, "getRefundContext").mockResolvedValue(result);
  return { ctx: { runQuery } as never, runQuery, read };
}
afterEach(() => vi.restoreAllMocks());
it("binds a seller read to the original merchant and rejects browser authority fields", async () => {
  const f = setup();
  await expect(
    reference.readSellerRefundContext(f.ctx, "seller", {
      ...options,
      actor: { type: "admin" },
      stripeAccountId: "acct_foreign",
    } as never),
  ).resolves.toEqual(result);
  expect(f.read).toHaveBeenCalledWith(f.ctx, {
    ...options,
    actor: { type: "seller", accountId: "acct_seller" },
  });
  expect(f.runQuery).toHaveBeenCalledTimes(2);
});
it("accepts the original store leg without granting affiliate authority", async () => {
  const f = setup(mapping, {
    splitRecipients: [{ role: "store", destinationAccountId: "acct_seller" }],
  });
  await reference.readSellerRefundContext(f.ctx, "seller", options);
  expect(f.read).toHaveBeenCalledOnce();
});
it.each([
  null,
  { userId: "other", stripeAccountId: "acct_seller" },
  { ...mapping, orgId: "org" },
])("rejects unavailable or foreign personal mapping %j", async (account) => {
  const f = setup(account);
  await expect(
    reference.readSellerRefundContext(f.ctx, "seller", options),
  ).rejects.toThrow();
  expect(f.read).not.toHaveBeenCalled();
});
it.each([
  null,
  { destinationAccountId: "acct_other" },
  {
    splitRecipients: [
      { role: "affiliate", destinationAccountId: "acct_seller" },
    ],
  },
])("rejects a payment without merchant ownership %j", async (payment) => {
  const f = setup(mapping, payment);
  await expect(
    reference.readSellerRefundContext(f.ctx, "seller", options),
  ).rejects.toThrow();
  expect(f.read).not.toHaveBeenCalled();
});
it("rejects a blank persona before account or provider reads", async () => {
  const f = setup();
  await expect(
    reference.readSellerRefundContext(f.ctx, "  ", options),
  ).rejects.toThrow();
  expect(f.runQuery).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});
it("propagates provider failures without inventing a zero refund balance", async () => {
  const f = setup();
  const error = new Error("provider unavailable");
  f.read.mockRejectedValue(error);
  await expect(
    reference.readSellerRefundContext(f.ctx, "seller", options),
  ).rejects.toBe(error);
});
