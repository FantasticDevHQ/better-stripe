import { afterEach, expect, it, vi } from "vitest";
import type { GenericId } from "convex/values";
import { stripe } from "../stripe/helpers.js";
import { readSellerRefundCommandEvidence } from "./refundCommandEvidence.js";

const original = {
  commandKey: "dojo-refund:original_command:v1",
  stripeAccountId: "acct_original",
  stripePaymentIntentId: "pi_original",
  stripeChargeId: "ch_original",
  currency: "jpy",
};
const account = {
  _id: "account" as GenericId<"accounts">,
  _creationTime: 1,
  stripeAccountId: "acct_original",
  userId: "seller",
  onboardingStatus: "complete" as const,
};
const result = {
  status: "unavailable",
  reason: "normalization_incomplete",
} as const;
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const mapping = vi
    .spyOn(stripe, "getPersonalAccountMapping")
    .mockResolvedValue({ status: "unique", account });
  const read = vi
    .spyOn(stripe, "getRefundCommandEvidence")
    .mockResolvedValue(result);
  return { mapping, read, ctx: { runQuery: vi.fn() } as never };
}
it("forwards only the original command and preserves unavailable normalization coverage", async () => {
  const f = fixture();
  expect(
    await readSellerRefundCommandEvidence(f.ctx, "seller", {
      ...original,
      actor: { type: "admin" },
      accountId: "acct_browser",
    } as never),
  ).toEqual(result);
  expect(f.mapping).toHaveBeenCalledWith(f.ctx, { userId: "seller" });
  expect(f.read).toHaveBeenCalledWith(f.ctx, original);
});
it.each([
  { status: "unavailable", reason: "ambiguous" },
  { status: "unique", account: { ...account, userId: "foreign" } },
  {
    status: "unique",
    account: { ...account, stripeAccountId: "acct_replacement" },
  },
  { status: "unique", account: { ...account, orgId: "organization" } },
])(
  "does not remap a former merchant through a current or foreign account %#",
  async (mapping) => {
    const f = fixture();
    f.mapping.mockResolvedValue(mapping as never);
    await expect(
      readSellerRefundCommandEvidence(f.ctx, "seller", original),
    ).rejects.toThrow();
    expect(f.read).not.toHaveBeenCalled();
  },
);
it("propagates component failures instead of fabricating receipt absence", async () => {
  const f = fixture();
  const error = new Error("component unavailable");
  f.read.mockRejectedValue(error);
  await expect(
    readSellerRefundCommandEvidence(f.ctx, "seller", original),
  ).rejects.toBe(error);
});
