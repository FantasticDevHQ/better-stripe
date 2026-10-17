import { modules } from "../../test";
// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
const raw = vi.hoisted(() => ({ accountSessions: { create: vi.fn() } }));
vi.mock("stripe", () => ({
  default: class {
    accountSessions = raw.accountSessions;
  },
}));
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
      await t.action(api.embeddedExamples.public.actions.createSession, {
        userId,
        kind: "payouts",
      }),
    ).toEqual({ clientSecret: "test_secret", expiresAt: 123 });
    expect(raw.accountSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        account: `acct_${role}`,
        components: {
          payouts: {
            enabled: true,
            features: {
              standard_payouts: false,
              instant_payouts: false,
              external_account_collection: false,
              edit_payout_schedule: false,
            },
          },
        },
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
    t.action(api.embeddedExamples.public.actions.createSession, {
      userId,
      kind: "refunds",
    }),
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
  await t.action(api.embeddedExamples.public.actions.createSession, {
    userId,
    kind: "refunds",
  });
  expect(
    raw.accountSessions.create.mock.calls[0][0].components.payments.features
      .refund_management,
  ).toBe(true);
});

it("uses package error normalization for an authorized session request", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "seller",
      name: "Seller",
      email: "s@example.com",
      stripeAccountId: "acct_s",
    }),
  );
  raw.accountSessions.create.mockRejectedValue(new Error("upstream failed"));
  await expect(
    t.action(api.embeddedExamples.public.actions.createSession, {
      userId,
      kind: "account",
    }),
  ).rejects.toThrow(/Failed to create account session/);
});
