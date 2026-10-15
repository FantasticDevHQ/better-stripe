// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
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
it("requires authentication and binds affiliate reads to their server-linked account", async () => {
  const t = convexTest(schema, modules);
  const args = {
    currency: "usd",
    paginationOpts: { numItems: 10, cursor: null },
  };
  expect(await t.query(api.affiliateRecovery.snapshot, args)).toBeNull();
  await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "affiliate",
      name: "A",
      email: "a@example.test",
      stripeAccountId: "acct_a",
      authTokenIdentifier: "issuer|a",
    }),
  );
  const actor = t.withIdentity({
    subject: "a",
    issuer: "issuer",
    tokenIdentifier: "issuer|a",
  });
  await actor.query(api.affiliateRecovery.snapshot, args);
  expect(calls.snapshot).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ affiliateAccountId: "acct_a" }),
  );
  await expect(
    actor.query(api.affiliateRecovery.snapshot, {
      ...args,
      affiliateAccountId: "acct_other",
    }),
  ).rejects.toThrow("not available");
  await expect(
    actor.query(api.affiliateRecovery.history, {
      obligationId: "other",
      paginationOpts: args.paginationOpts,
    }),
  ).rejects.toThrow("not available");
  await expect(
    actor.query(internal.affiliateRecovery.requireOperator, {}),
  ).rejects.toThrow("authenticated operator");
});
it("does not grant operator rights from a browser-selected persona", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "admin",
      name: "Demo admin",
      email: "admin@example.test",
    }),
  );
  await expect(
    t.action(api.affiliateRecovery.retry, { obligationId: "any" }),
  ).rejects.toThrow("authenticated operator");
  expect(calls.retry).not.toHaveBeenCalled();
});
it("allows a provisioned authenticated operator to inspect another affiliate", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      role: "admin",
      name: "Operator",
      email: "op@example.test",
      authTokenIdentifier: "issuer|op",
    }),
  );
  const actor = t.withIdentity({
    subject: "op",
    issuer: "issuer",
    tokenIdentifier: "issuer|op",
  });
  await actor.query(api.affiliateRecovery.snapshot, {
    affiliateAccountId: "acct_other",
    currency: "usd",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(calls.snapshot).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ affiliateAccountId: "acct_other" }),
  );
});
