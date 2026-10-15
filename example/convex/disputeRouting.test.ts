// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, it, expect, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { stripe } from "./stripe";
vi.mock("./stripe", () => ({
  stripe: {
    getAccountByUserId: vi.fn(),
    getDisputeByStripeId: vi.fn(),
    updateDispute: vi.fn(),
  },
}));
const modules = import.meta.glob("./**/*.*s");
const mockedStripe = vi.mocked(stripe);
const OWNED_DISPUTE = { stripeDisputeId: "dp_1", accountId: "acct_owner" };
function accountFor() {
  return async () =>
    ({ stripeAccountId: "acct_owner" }) as Awaited<
      ReturnType<typeof stripe.getAccountByUserId>
    >;
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_mock_actions";
});
it.each([false, true])(
  "routes platform-charge evidence with submit=%s while preserving seller authorization",
  async (submit) => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor());
    mockedStripe.getDisputeByStripeId.mockResolvedValue(
      OWNED_DISPUTE as Awaited<ReturnType<typeof stripe.getDisputeByStripeId>>,
    );
    mockedStripe.updateDispute.mockResolvedValue({ success: true });
    await t.action(api.actions.submitDisputeEvidence, {
      userId: "owner_1",
      stripeDisputeId: "dp_1",
      evidence: { product_description: "widget" },
      submit,
    });
    expect(mockedStripe.updateDispute).toHaveBeenCalledWith(expect.anything(), {
      stripeDisputeId: "dp_1",
      evidence: { product_description: "widget" },
      submit,
      actor: { type: "seller", accountId: "acct_owner" },
    });
  },
);
it("rejects browser-provided attachment IDs, even for the owning seller", async () => {
  mockedStripe.getAccountByUserId.mockImplementation(accountFor());
  mockedStripe.getDisputeByStripeId.mockResolvedValue(
    OWNED_DISPUTE as Awaited<ReturnType<typeof stripe.getDisputeByStripeId>>,
  );
  await expect(
    convexTest(schema, modules).action(api.actions.submitDisputeEvidence, {
      userId: "owner_1",
      stripeDisputeId: "dp_1",
      evidence: { customer_communication: "file_unbound" } as never,
      submit: false,
    }),
  ).rejects.toThrow();
  expect(mockedStripe.updateDispute).not.toHaveBeenCalled();
});
