// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { stripe } from "./stripe";
vi.mock("./stripe", () => ({
  stripe: {
    getAccountByUserId: vi.fn(),
    getDisputeByStripeId: vi.fn(),
    uploadDisputeEvidence: vi.fn(),
  },
}));
const modules = import.meta.glob("./**/*.*s");
const mocked = vi.mocked(stripe);
const args = {
  userId: "seller",
  stripeDisputeId: "dp_1",
  data: new TextEncoder().encode("%PDF-1.7").buffer,
  name: "proof.pdf",
  type: "application/pdf" as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_mock";
  mocked.getAccountByUserId.mockResolvedValue({
    stripeAccountId: "acct_owner",
  } as Awaited<ReturnType<typeof stripe.getAccountByUserId>>);
  mocked.getDisputeByStripeId.mockResolvedValue({
    accountId: "acct_owner",
  } as Awaited<ReturnType<typeof stripe.getDisputeByStripeId>>);
  mocked.uploadDisputeEvidence.mockResolvedValue({
    stripeFileId: "file_1",
    stripeDisputeId: "dp_1",
  });
});
it("derives the actor from the verified dispute and stages communication bytes", async () => {
  await convexTest(schema, modules).action(
    api.actions.uploadDisputeEvidence,
    args,
  );
  expect(mocked.uploadDisputeEvidence).toHaveBeenCalledWith(expect.anything(), {
    stripeDisputeId: "dp_1",
    actor: { type: "seller", accountId: "acct_owner" },
    field: "customer_communication",
    file: { data: new Uint8Array(args.data), name: args.name, type: args.type },
  });
});
it("rejects unowned disputes before uploading", async () => {
  mocked.getDisputeByStripeId.mockResolvedValue({
    accountId: "acct_other",
  } as Awaited<ReturnType<typeof stripe.getDisputeByStripeId>>);
  await expect(
    convexTest(schema, modules).action(api.actions.uploadDisputeEvidence, args),
  ).rejects.toThrow();
  expect(mocked.uploadDisputeEvidence).not.toHaveBeenCalled();
});
