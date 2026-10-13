// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const raw = vi.hoisted(() => ({ accountSessions: { create: vi.fn() } }));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
const modules = import.meta.glob("./**/*.*s");
beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
  vi.resetAllMocks();
  raw.accountSessions.create.mockResolvedValue({
    client_secret: "test_secret",
    expires_at: 123,
  });
});
for (const role of ["seller", "affiliate"] as const)
  it(`scopes ${role} payout sessions to its canonical account`, async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        role,
        name: role,
        email: `${role}@example.com`,
        stripeAccountId: `acct_${role}`,
      }),
    );
    expect(
      await t.action(api.embeddedExamples.createSession, {
        userId,
        kind: "payouts",
      }),
    ).toEqual({ clientSecret: "test_secret", expiresAt: 123 });
    expect(raw.accountSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        account: `acct_${role}`,
        components: { payouts: expect.objectContaining({ enabled: true }) },
      }),
    );
  });
it("refuses seller payment features for affiliates before calling Stripe", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "affiliate",
      name: "Affiliate",
      email: "a@example.com",
      stripeAccountId: "acct_a",
    }),
  );
  await expect(
    t.action(api.embeddedExamples.createSession, { userId, kind: "refunds" }),
  ).rejects.toThrow(/seller/);
  expect(raw.accountSessions.create).not.toHaveBeenCalled();
});
it("enables refund management only in the refund example", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "seller",
      name: "Seller",
      email: "s@example.com",
      stripeAccountId: "acct_s",
    }),
  );
  await t.action(api.embeddedExamples.createSession, {
    userId,
    kind: "refunds",
  });
  expect(
    raw.accountSessions.create.mock.calls[0][0].components.payments.features
      .refund_management,
  ).toBe(true);
});
