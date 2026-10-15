// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
const calls = vi.hoisted(() => ({
  snapshot: vi.fn(async () => ({
    balance: null,
    obligations: { page: [], continueCursor: "", isDone: true },
  })),
  obligation: vi.fn(async () => ({ affiliateAccountId: "acct_other" })),
  history: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("./stripe", () => ({ stripe: { affiliateRecovery: calls } }));
const modules = import.meta.glob("./**/*.*s");
beforeEach(() => vi.clearAllMocks());
it("binds demo affiliate reads to the persona's server-linked account", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "affiliate",
      name: "A",
      email: "a@example.test",
      stripeAccountId: "acct_a",
    }),
  );
  const args = {
    userId,
    currency: "usd",
    paginationOpts: { numItems: 10, cursor: null },
  };
  await t.query(api.affiliateRecovery.snapshot, args);
  expect(calls.snapshot).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ affiliateAccountId: "acct_a" }),
  );
  await expect(
    t.query(api.affiliateRecovery.snapshot, {
      ...args,
      affiliateAccountId: "acct_other",
    }),
  ).rejects.toThrow("not available");
  await expect(
    t.query(api.affiliateRecovery.history, {
      userId,
      obligationId: "other",
      paginationOpts: args.paginationOpts,
    }),
  ).rejects.toThrow("not available");
  await expect(
    t.action(api.affiliateRecovery.retry, { userId, obligationId: "any" }),
  ).rejects.toThrow("operator persona");
  expect(calls.retry).not.toHaveBeenCalled();
});
it("allows the demo admin to inspect another affiliate", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "admin",
      name: "Operator",
      email: "op@example.test",
    }),
  );
  await t.query(api.affiliateRecovery.snapshot, {
    userId,
    affiliateAccountId: "acct_other",
    currency: "usd",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(calls.snapshot).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ affiliateAccountId: "acct_other" }),
  );
  await t.query(internal.affiliateRecovery.requireOperator, { userId });
});
it("rejects missing and ineligible personas", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "buyer",
      name: "Buyer",
      email: "b@example.test",
    }),
  );
  const args = {
    userId,
    currency: "usd",
    paginationOpts: { numItems: 10, cursor: null },
  };
  expect(await t.query(api.affiliateRecovery.snapshot, args)).toBeNull();
  await t.run((ctx) => ctx.db.delete("users", userId));
  expect(await t.query(api.affiliateRecovery.snapshot, args)).toBeNull();
  expect(calls.snapshot).not.toHaveBeenCalled();
});
it("denies demo retries when the deployment is not test-mode", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "admin",
      name: "Operator",
      email: "op@example.test",
    }),
  );
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_forbidden");
  try {
    await expect(
      t.action(api.affiliateRecovery.retry, { userId, obligationId: "any" }),
    ).rejects.toThrow("not a test-mode key");
    expect(calls.retry).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});
