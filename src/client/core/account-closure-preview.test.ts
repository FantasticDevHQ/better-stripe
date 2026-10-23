// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { RunCtx } from "../helpers.js";
import { components, initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import { previewAccountClosure } from "./accountClosurePreview.js";

const modules = import.meta.glob("../../component/**/*.ts");
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const component = components.betterStripe;
  await t.mutation(component.core.mutations.upsertAccount, {
    stripeAccountId: "acct_preview",
    userId: "owner",
    appliedConfigurations: ["recipient"],
  });
  const retrieve = vi.fn().mockResolvedValue({
    id: "acct_preview",
    closed: false,
    applied_configurations: ["customer", "recipient"],
  });
  const balance = vi.fn().mockResolvedValue({
    available: [
      { amount: 100, currency: "usd" },
      { amount: -50, currency: "eur" },
    ],
    pending: [{ amount: -100, currency: "usd" }],
  });
  const sessions = vi.fn().mockResolvedValue({
    data: [
      {
        id: "cs_open",
        object: "checkout.session",
        customer_account: "acct_preview",
        status: "open",
        created: 100,
      },
    ],
    has_more: true,
  });
  const close = vi.fn();
  const stripe = {
    v2: { core: { accounts: { retrieve, close } } },
    balance: { retrieve: balance },
    checkout: { sessions: { list: sessions } },
  } as unknown as Stripe;
  const runMutation = vi.fn(t.mutation);
  const ctx = { runQuery: t.query, runMutation } as RunCtx;
  return {
    t,
    component,
    ctx,
    stripe,
    retrieve,
    balance,
    sessions,
    close,
    runMutation,
  };
}

it("observes exact scope and separate currencies, retaining known blockers and unknown completeness without writes", async () => {
  const f = await fixture();
  const before = await f.t.query(
    f.component.core.queries.getAccountByStripeId,
    { stripeAccountId: "acct_preview" },
  );
  const result = await previewAccountClosure(f.stripe, f.component, f.ctx, {
    stripeAccountId: "acct_preview",
    sessionLimit: 10,
  });
  expect(result.account).toEqual({
    status: "observed",
    value: { closed: false, appliedConfigurations: ["customer", "recipient"] },
  });
  expect(result.balances).toEqual({
    status: "observed",
    value: [
      { currency: "usd", available: 100, pending: -100 },
      { currency: "eur", available: -50, pending: 0 },
    ],
  });
  expect(result.knownBlockers).toEqual(
    expect.arrayContaining(["nonzero_balance", "open_checkout_sessions"]),
  );
  expect(result.unknownReasons).toEqual(
    expect.arrayContaining([
      "financial_coverage_unknown",
      "open_sessions_truncated",
    ]),
  );
  expect(result.financialCoverage).toBe("unknown");
  expect(result).not.toHaveProperty("eligible");
  expect(f.runMutation).not.toHaveBeenCalled();
  expect(f.close).not.toHaveBeenCalled();
  expect(
    await f.t.query(f.component.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_preview",
    }),
  ).toEqual(before);
});

it("keeps failed or unsupported observations unknown without inventing zero balances or empty sessions", async () => {
  const f = await fixture();
  f.retrieve.mockRejectedValue(new Error("Unavailable"));
  f.balance.mockRejectedValue(new Error("Unsupported"));
  f.sessions.mockResolvedValue({ data: [], has_more: true });
  const result = await previewAccountClosure(f.stripe, f.component, f.ctx, {
    stripeAccountId: "acct_preview",
  });
  expect(result.account.status).toBe("unknown");
  expect(result.balances.status).toBe("unknown");
  expect(result.openSessions.status).toBe("unknown");
  expect(result.unknownReasons).toEqual(
    expect.arrayContaining([
      "account_unavailable",
      "balances_unavailable",
      "open_sessions_unavailable",
    ]),
  );
  expect(f.runMutation).not.toHaveBeenCalled();
});

it("keeps complete empty observations separate from financial clearance and bounds the exact open-session read", async () => {
  const f = await fixture();
  f.balance.mockResolvedValue({ available: [], pending: [] });
  f.sessions.mockResolvedValue({ data: [], has_more: false });
  const result = await previewAccountClosure(f.stripe, f.component, f.ctx, {
    stripeAccountId: "acct_preview",
    sessionLimit: 1,
  });
  expect(result.knownBlockers).toEqual([]);
  expect(result.openSessions).toEqual({
    status: "observed",
    value: { sessionIds: [], hasMore: false },
  });
  expect(result.unknownReasons).toEqual(["financial_coverage_unknown"]);
  expect(f.sessions).toHaveBeenCalledWith({
    customer_account: "acct_preview",
    status: "open",
    limit: 1,
  });
  expect(f.runMutation).not.toHaveBeenCalled();
  await expect(
    previewAccountClosure(f.stripe, f.component, f.ctx, {
      stripeAccountId: "acct_preview",
      sessionLimit: 101,
    }),
  ).rejects.toThrow();
  expect(f.sessions).toHaveBeenCalledTimes(1);
});

it("does not substitute foreign provider scope or malformed balance amounts into an observation", async () => {
  const f = await fixture();
  f.retrieve.mockResolvedValue({
    id: "acct_foreign",
    closed: false,
    applied_configurations: [],
  });
  f.balance.mockResolvedValue({
    available: [{ amount: Number.NaN, currency: "usd" }],
    pending: [],
  });
  const result = await previewAccountClosure(f.stripe, f.component, f.ctx, {
    stripeAccountId: "acct_preview",
  });
  expect(result.account.status).toBe("unknown");
  expect(result.balances.status).toBe("unknown");
  expect(result.financialCoverage).toBe("unknown");
  expect(f.close).not.toHaveBeenCalled();
});

it("exposes the supported public SDK preview and guarded close using actual registered component reads", async () => {
  const f = await fixture();
  const {
    BetterStripe,
    closeAccountOptionsSchema,
    accountClosurePreviewOptionsSchema,
  } = await import("../index.js");
  const { getStripeClient } = await import("../helpers.js");
  const key = `sk_test_closure_preview_${crypto.randomUUID()}`;
  const client = new BetterStripe(f.component, { STRIPE_SECRET_KEY: key });
  const raw = getStripeClient(key);
  vi.spyOn(raw.v2.core.accounts, "retrieve").mockImplementation(f.retrieve);
  vi.spyOn(raw.balance, "retrieve").mockImplementation(f.balance);
  vi.spyOn(raw.checkout.sessions, "list").mockImplementation(f.sessions);
  const close = vi
    .spyOn(raw.v2.core.accounts, "close")
    .mockRejectedValue(new Error("No provider write expected"));
  expect(
    closeAccountOptionsSchema.safeParse({
      stripeAccountId: "acct_preview",
      expectedAppliedConfigurations: ["recipient", "recipient"],
    }).success,
  ).toBe(false);
  expect(
    accountClosurePreviewOptionsSchema.safeParse({
      stripeAccountId: "acct_preview",
      sessionLimit: 101,
    }).success,
  ).toBe(false);
  const result = await client.previewAccountClosure(f.ctx, {
    stripeAccountId: "acct_preview",
  });
  expect(result.account.status).toBe("observed");
  expect(result.componentBlockers).toEqual({ status: "observed", value: [] });
  expect(result.financialCoverage).toBe("unknown");
  expect(f.runMutation).not.toHaveBeenCalled();
  await expect(
    client.closeAccount(f.ctx, {
      stripeAccountId: "acct_preview",
      expectedAppliedConfigurations: ["recipient"],
    }),
  ).rejects.toThrow();
  expect(close).not.toHaveBeenCalled();
});
