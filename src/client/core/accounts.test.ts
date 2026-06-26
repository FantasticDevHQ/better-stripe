/**
 * Tests for the core Account methods. These functions span three boundaries:
 * the Stripe V2 Accounts SDK (`stripe.v2.core.accounts.*` plus `accountLinks`),
 * the component query/mutation layer (resolved via `componentRef`), and the
 * `deriveAccountStatus` helper. The headline targets are the multi-step
 * orchestrators — `createAccount`, `createAccountWithOnboarding` (with its
 * rollback path), `getOrCreateAccount`, `closeAccount` (DB-vs-Stripe fallback),
 * `listStripeAccounts`, and `syncAllAccounts` (manual pagination + per-record
 * error accumulation). We assert the exact params handed to each boundary, the
 * shapes returned, every branch, and the error/rollback paths.
 */
import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import {
  DEFAULT_ACCOUNT_CONFIGURATION,
  DEFAULT_ACCOUNT_DEFAULTS,
  addRecipientConfiguration,
  closeAccount,
  createAccount,
  createAccountWithOnboarding,
  getAccount,
  getAccountByOrgId,
  getAccountByStripeId,
  getAccountByUserId,
  getAccountOnboardingStatus,
  getOrCreateAccount,
  getV2Account,
  listStripeAccounts,
  restartAccountOnboarding,
  syncAllAccounts,
  updateAccount,
  updateV2Account,
  upsertAccount,
} from "./accounts.js";

const TO_REF = Symbol.for("toReferencePath");

/** A fake component whose nested refs carry the Symbol the resolver looks up. */
function makeComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    core: {
      queries: {
        getAccount: ref("core/queries/getAccount"),
        getAccountByStripeId: ref("core/queries/getAccountByStripeId"),
        getAccountByUserId: ref("core/queries/getAccountByUserId"),
        getAccountByOrgId: ref("core/queries/getAccountByOrgId"),
        getAccountOnboardingStatus: ref("core/queries/getAccountOnboardingStatus"),
      },
      mutations: {
        upsertAccount: ref("core/mutations/upsertAccount"),
        deleteAccountByStripeId: ref("core/mutations/deleteAccountByStripeId"),
      },
    },
  } as unknown as Component;
}

/** The reference object the resolver returns for a given path. */
function refFor(path: string) {
  return { [TO_REF]: `betterStripe/${path}` };
}

/** Build a mock Stripe instance exposing only the slice these helpers touch. */
function makeStripe() {
  return {
    v2: {
      core: {
        accounts: {
          create: vi.fn(),
          update: vi.fn(),
          retrieve: vi.fn(),
          list: vi.fn(),
          close: vi.fn(),
        },
      },
    },
    accountLinks: { create: vi.fn() },
  };
}

type MockStripe = ReturnType<typeof makeStripe>;
const asStripe = (s: MockStripe) =>
  s as unknown as Parameters<typeof createAccount>[0];

describe("createAccount", () => {
  it("creates the V2 account, upserts it, and returns the stored internal id", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_1" });
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const runQuery = vi.fn().mockResolvedValue({ _id: "internal_1" });
    const ctx = { runMutation, runQuery } as unknown as RunCtx;

    const result = await createAccount(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      email: "a@b.com",
      name: "Acme",
      country: "US",
    });

    expect(result).toEqual({
      accountId: "internal_1",
      stripeAccountId: "acct_1",
    });

    // Stripe create params: contact_email + metadata (userId injected), identity from country
    expect(stripe.v2.core.accounts.create).toHaveBeenCalledWith({
      contact_email: "a@b.com",
      metadata: { userId: "user_1" },
      identity: { country: "US" },
    });

    // Upsert mutation carries the derived metadata and pending defaults
    expect(runMutation).toHaveBeenCalledWith(
      refFor("core/mutations/upsertAccount"),
      {
        stripeAccountId: "acct_1",
        userId: "user_1",
        orgId: undefined,
        email: "a@b.com",
        name: "Acme",
        country: "US",
        appliedConfigurations: [],
        onboardingStatus: "pending",
        metadata: { userId: "user_1" },
      },
    );

    // Read-back query keyed by the new Stripe id
    expect(runQuery).toHaveBeenCalledWith(
      refFor("core/queries/getAccountByStripeId"),
      { stripeAccountId: "acct_1" },
    );
  });

  it("merges orgId and caller metadata, and omits identity when no country", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_2" });
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const runQuery = vi.fn().mockResolvedValue({ _id: "internal_2" });
    const ctx = { runMutation, runQuery } as unknown as RunCtx;

    await createAccount(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_2",
      orgId: "org_2",
      metadata: { plan: "pro" },
    });

    const createArg = stripe.v2.core.accounts.create.mock.calls[0][0];
    expect(createArg).toEqual({
      contact_email: undefined,
      metadata: { plan: "pro", userId: "user_2", orgId: "org_2" },
    });
    // no country → no identity key at all
    expect("identity" in createArg).toBe(false);
  });

  it("returns null accountId when the stored row cannot be read back", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_3" });
    const ctx = {
      runMutation: vi.fn().mockResolvedValue(undefined),
      runQuery: vi.fn().mockResolvedValue(null),
    } as unknown as RunCtx;

    const result = await createAccount(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_3",
    });

    expect(result).toEqual({ accountId: null, stripeAccountId: "acct_3" });
  });

  it("throws when ctx has no runMutation", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_4" });
    const ctx = { runQuery: vi.fn() } as unknown as RunCtx;

    await expect(
      createAccount(asStripe(stripe), makeComponent(), ctx, { userId: "u" }),
    ).rejects.toThrow(/requires a Convex ctx with runMutation/);
  });
});

describe("createAccountWithOnboarding", () => {
  function happyCtx() {
    return {
      runMutation: vi.fn().mockResolvedValue(undefined),
      runQuery: vi.fn().mockResolvedValue({ _id: "internal_x" }),
    } as unknown as RunCtx & { runMutation: ReturnType<typeof vi.fn> };
  }

  it("applies default configuration, re-fetches applied configs, and returns the onboarding url", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_ob" });
    stripe.v2.core.accounts.update.mockResolvedValue({});
    stripe.v2.core.accounts.retrieve.mockResolvedValue({
      applied_configurations: ["merchant"],
    });
    stripe.accountLinks.create.mockResolvedValue({ url: "https://onboard" });
    const ctx = happyCtx();

    const result = await createAccountWithOnboarding(
      asStripe(stripe),
      makeComponent(),
      ctx,
      {
        userId: "user_ob",
        country: "US",
        refreshUrl: "https://refresh",
        returnUrl: "https://return",
      },
    );

    expect(result).toEqual({
      stripeAccountId: "acct_ob",
      onboardingUrl: "https://onboard",
    });

    // defaults applied + dashboard defaults to "express"
    expect(stripe.v2.core.accounts.update).toHaveBeenCalledWith("acct_ob", {
      configuration: DEFAULT_ACCOUNT_CONFIGURATION,
      dashboard: "express",
      defaults: DEFAULT_ACCOUNT_DEFAULTS,
    });

    // second upsert records the applied configs + in_progress status
    const secondUpsert = (ctx.runMutation as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) =>
        c[1].onboardingStatus === "in_progress" &&
        c[1].stripeAccountId === "acct_ob",
    );
    expect(secondUpsert?.[1]).toEqual({
      stripeAccountId: "acct_ob",
      userId: "user_ob",
      appliedConfigurations: ["merchant"],
      onboardingStatus: "in_progress",
    });

    // account link built with the right type + urls
    expect(stripe.accountLinks.create).toHaveBeenCalledWith({
      account: "acct_ob",
      refresh_url: "https://refresh",
      return_url: "https://return",
      type: "account_onboarding",
    });
  });

  it("honours caller-provided configuration, defaults, and dashboard", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_cfg" });
    stripe.v2.core.accounts.update.mockResolvedValue({});
    stripe.v2.core.accounts.retrieve.mockResolvedValue({});
    stripe.accountLinks.create.mockResolvedValue({ url: "https://onboard" });
    const ctx = happyCtx();

    await createAccountWithOnboarding(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_cfg",
      country: "GB",
      refreshUrl: "https://refresh",
      returnUrl: "https://return",
      accountConfiguration: { recipient: {} },
      accountDefaults: { locales: ["en"] },
      dashboard: "none",
    });

    expect(stripe.v2.core.accounts.update).toHaveBeenCalledWith("acct_cfg", {
      configuration: { recipient: {} },
      dashboard: "none",
      defaults: { locales: ["en"] },
    });
  });

  it("defaults applied_configurations to [] when Stripe omits them", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_empty" });
    stripe.v2.core.accounts.update.mockResolvedValue({});
    stripe.v2.core.accounts.retrieve.mockResolvedValue({}); // no applied_configurations
    stripe.accountLinks.create.mockResolvedValue({ url: "https://onboard" });
    const ctx = happyCtx();

    await createAccountWithOnboarding(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_empty",
      country: "US",
      refreshUrl: "https://refresh",
      returnUrl: "https://return",
    });

    const inProgress = (ctx.runMutation as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[1].onboardingStatus === "in_progress",
    );
    expect(inProgress?.[1].appliedConfigurations).toEqual([]);
  });

  it("rolls back the Convex account and throws ACCOUNT_CREATE_FAILED when config update fails", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_fail" });
    stripe.v2.core.accounts.update.mockRejectedValue(new Error("config boom"));
    const ctx = happyCtx();

    await expect(
      createAccountWithOnboarding(asStripe(stripe), makeComponent(), ctx, {
        userId: "user_fail",
        country: "US",
        refreshUrl: "https://refresh",
        returnUrl: "https://return",
      }),
    ).rejects.toMatchObject({ data: { code: "ACCOUNT_CREATE_FAILED" } });

    // rollback deletes the half-created account
    expect(ctx.runMutation).toHaveBeenCalledWith(
      refFor("core/mutations/deleteAccountByStripeId"),
      { stripeAccountId: "acct_fail" },
    );
    // never reached the account-link creation
    expect(stripe.accountLinks.create).not.toHaveBeenCalled();
  });

  it("still throws ACCOUNT_CREATE_FAILED even if the rollback delete also fails", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_fail2" });
    stripe.v2.core.accounts.update.mockRejectedValue(new Error("config boom"));
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(undefined) // initial upsert in createAccount
      .mockRejectedValueOnce(new Error("delete boom")); // rollback delete fails
    const ctx = {
      runMutation,
      runQuery: vi.fn().mockResolvedValue({ _id: "internal_x" }),
    } as unknown as RunCtx;

    await expect(
      createAccountWithOnboarding(asStripe(stripe), makeComponent(), ctx, {
        userId: "user_fail2",
        country: "US",
        refreshUrl: "https://refresh",
        returnUrl: "https://return",
      }),
    ).rejects.toMatchObject({ data: { code: "ACCOUNT_CREATE_FAILED" } });
  });
});

describe("getOrCreateAccount", () => {
  it("returns an existing account looked up by orgId without creating", async () => {
    const stripe = makeStripe();
    const runQuery = vi.fn().mockResolvedValue({
      _id: "internal_e",
      stripeAccountId: "acct_existing",
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as RunCtx;

    const result = await getOrCreateAccount(
      asStripe(stripe),
      makeComponent(),
      ctx,
      { userId: "user_e", orgId: "org_e" },
    );

    expect(result).toEqual({
      accountId: "internal_e",
      stripeAccountId: "acct_existing",
      isNew: false,
    });
    // orgId branch → getAccountByOrgId
    expect(runQuery).toHaveBeenCalledWith(
      refFor("core/queries/getAccountByOrgId"),
      { orgId: "org_e" },
    );
    expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
  });

  it("looks up by userId when no orgId is supplied", async () => {
    const stripe = makeStripe();
    const runQuery = vi.fn().mockResolvedValue({
      _id: "internal_u",
      stripeAccountId: "acct_u",
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as RunCtx;

    await getOrCreateAccount(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_u",
    });

    expect(runQuery).toHaveBeenCalledWith(
      refFor("core/queries/getAccountByUserId"),
      { userId: "user_u" },
    );
  });

  it("creates a new account and flags isNew when none exists", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_new" });
    // first query = existence check (null), second = read-back in createAccount
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: "internal_new" });
    const ctx = {
      runQuery,
      runMutation: vi.fn().mockResolvedValue(undefined),
    } as unknown as RunCtx;

    const result = await getOrCreateAccount(
      asStripe(stripe),
      makeComponent(),
      ctx,
      { userId: "user_new" },
    );

    expect(result).toEqual({
      accountId: "internal_new",
      stripeAccountId: "acct_new",
      isNew: true,
    });
  });
});

describe("read delegators", () => {
  it("getAccount queries getAccount with the opts", async () => {
    const runQuery = vi.fn().mockResolvedValue({ _id: "a" });
    const ctx = { runQuery } as unknown as RunCtx;
    const result = await getAccount(makeComponent(), ctx, { accountId: "a" });
    expect(result).toEqual({ _id: "a" });
    expect(runQuery).toHaveBeenCalledWith(refFor("core/queries/getAccount"), {
      accountId: "a",
    });
  });

  it("getAccountByUserId queries getAccountByUserId", async () => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const ctx = { runQuery } as unknown as RunCtx;
    const result = await getAccountByUserId(makeComponent(), ctx, {
      userId: "u",
    });
    expect(result).toBeNull();
    expect(runQuery).toHaveBeenCalledWith(
      refFor("core/queries/getAccountByUserId"),
      { userId: "u" },
    );
  });

  it("getAccountByOrgId queries getAccountByOrgId", async () => {
    const runQuery = vi.fn().mockResolvedValue({ _id: "o" });
    const ctx = { runQuery } as unknown as RunCtx;
    await getAccountByOrgId(makeComponent(), ctx, { orgId: "o" });
    expect(runQuery).toHaveBeenCalledWith(
      refFor("core/queries/getAccountByOrgId"),
      { orgId: "o" },
    );
  });

  it("getAccountByStripeId queries getAccountByStripeId", async () => {
    const runQuery = vi.fn().mockResolvedValue({ _id: "s" });
    const ctx = { runQuery } as unknown as RunCtx;
    await getAccountByStripeId(makeComponent(), ctx, {
      stripeAccountId: "acct_x",
    });
    expect(runQuery).toHaveBeenCalledWith(
      refFor("core/queries/getAccountByStripeId"),
      { stripeAccountId: "acct_x" },
    );
  });

  it("getAccountOnboardingStatus queries getAccountOnboardingStatus", async () => {
    const runQuery = vi.fn().mockResolvedValue({ onboardingStatus: "pending" });
    const ctx = { runQuery } as unknown as RunCtx;
    const result = await getAccountOnboardingStatus(makeComponent(), ctx, {
      accountId: "a",
    });
    expect(result).toEqual({ onboardingStatus: "pending" });
    expect(runQuery).toHaveBeenCalledWith(
      refFor("core/queries/getAccountOnboardingStatus"),
      { accountId: "a" },
    );
  });
});

describe("upsertAccount", () => {
  it("runs the upsert mutation with the raw opts and returns null", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = { runMutation } as unknown as RunCtx;
    const opts = {
      stripeAccountId: "acct_up",
      userId: "user_up",
      onboardingStatus: "complete" as const,
    };

    const result = await upsertAccount(makeComponent(), ctx, opts);

    expect(result).toBeNull();
    expect(runMutation).toHaveBeenCalledWith(
      refFor("core/mutations/upsertAccount"),
      opts,
    );
  });

  it("throws when ctx has no runMutation", async () => {
    const ctx = {} as unknown as RunCtx;
    await expect(
      upsertAccount(makeComponent(), ctx, {
        stripeAccountId: "acct_up",
        userId: "user_up",
      }),
    ).rejects.toThrow(/requires a Convex ctx with runMutation/);
  });
});

describe("updateAccount", () => {
  it("sends only the provided fields and returns success", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.update.mockResolvedValue({});
    const ctx = {} as RunCtx;

    const result = await updateAccount(asStripe(stripe), ctx, {
      stripeAccountId: "acct_u1",
      email: "new@b.com",
      metadata: { tier: "gold" },
    });

    expect(result).toEqual({ success: true });
    expect(stripe.v2.core.accounts.update).toHaveBeenCalledWith("acct_u1", {
      contact_email: "new@b.com",
      metadata: { tier: "gold" },
    });
  });

  it("sends an empty update when neither email nor metadata is provided", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.update.mockResolvedValue({});
    const ctx = {} as RunCtx;

    await updateAccount(asStripe(stripe), ctx, { stripeAccountId: "acct_u2" });

    expect(stripe.v2.core.accounts.update).toHaveBeenCalledWith("acct_u2", {});
  });
});

describe("getV2Account / updateV2Account", () => {
  it("getV2Account retrieves with the include array", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue({ id: "acct_g" });
    const result = await getV2Account(asStripe(stripe), {} as RunCtx, {
      stripeAccountId: "acct_g",
      include: ["identity"] as never,
    });
    expect(result).toEqual({ id: "acct_g" });
    expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledWith("acct_g", {
      include: ["identity"],
    });
  });

  it("updateV2Account passes through the raw update params", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.update.mockResolvedValue({ id: "acct_uv" });
    const updateParams = { contact_email: "x@y.com" } as never;
    const result = await updateV2Account(asStripe(stripe), {} as RunCtx, {
      stripeAccountId: "acct_uv",
      updateParams,
    });
    expect(result).toEqual({ id: "acct_uv" });
    expect(stripe.v2.core.accounts.update).toHaveBeenCalledWith(
      "acct_uv",
      updateParams,
    );
  });
});

describe("addRecipientConfiguration", () => {
  it("requests the recipient configuration and returns success", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.update.mockResolvedValue({});
    const result = await addRecipientConfiguration(
      asStripe(stripe),
      {} as RunCtx,
      { stripeAccountId: "acct_r" },
    );
    expect(result).toEqual({ success: true });
    expect(stripe.v2.core.accounts.update).toHaveBeenCalledWith("acct_r", {
      configuration: {
        recipient: { stripe_balance: { stripe_transfers: {} } },
      },
    });
  });
});

describe("listStripeAccounts", () => {
  it("paginates across pages until has_more is false", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list
      .mockResolvedValueOnce({
        data: [{ id: "acct_a" }, { id: "acct_b" }],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [{ id: "acct_c" }],
        has_more: false,
      });

    const result = await listStripeAccounts(asStripe(stripe), {} as RunCtx);

    expect(result.map((a) => a.id)).toEqual(["acct_a", "acct_b", "acct_c"]);
    // default limit 100, first page no starting_after
    expect(stripe.v2.core.accounts.list.mock.calls[0][0]).toEqual({
      limit: 100,
    });
    // second page carries starting_after = last id of page 1
    expect(stripe.v2.core.accounts.list.mock.calls[1][0]).toEqual({
      limit: 100,
      starting_after: "acct_b",
    });
  });

  it("honours an explicit limit and stops on an empty page", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list.mockResolvedValueOnce({
      data: [],
      has_more: true, // even though Stripe claims more, empty data must terminate
    });

    const result = await listStripeAccounts(asStripe(stripe), {} as RunCtx, {
      limit: 5,
    });

    expect(result).toEqual([]);
    expect(stripe.v2.core.accounts.list).toHaveBeenCalledTimes(1);
    expect(stripe.v2.core.accounts.list.mock.calls[0][0]).toEqual({ limit: 5 });
  });

  it("treats a missing data field as an empty page", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list.mockResolvedValueOnce({ has_more: false });
    const result = await listStripeAccounts(asStripe(stripe), {} as RunCtx);
    expect(result).toEqual([]);
  });
});

describe("closeAccount / restartAccountOnboarding", () => {
  it("uses stored appliedConfigurations from the DB and deletes after Stripe close", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.close.mockResolvedValue({});
    const runQuery = vi.fn().mockResolvedValue({
      appliedConfigurations: ["merchant", "recipient"],
    });
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = { runQuery, runMutation } as unknown as RunCtx;

    const result = await closeAccount(asStripe(stripe), makeComponent(), ctx, {
      stripeAccountId: "acct_close",
    });

    expect(result).toEqual({ closed: true });
    // never falls back to Stripe retrieve when DB has configs
    expect(stripe.v2.core.accounts.retrieve).not.toHaveBeenCalled();
    expect(stripe.v2.core.accounts.close).toHaveBeenCalledWith("acct_close", {
      applied_configurations: ["merchant", "recipient"],
    });
    expect(runMutation).toHaveBeenCalledWith(
      refFor("core/mutations/deleteAccountByStripeId"),
      { stripeAccountId: "acct_close" },
    );
  });

  it("falls back to Stripe retrieve when the DB has no applied configs", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue({
      applied_configurations: ["merchant"],
    });
    stripe.v2.core.accounts.close.mockResolvedValue({});
    const ctx = {
      runQuery: vi.fn().mockResolvedValue(null), // no DB row
      runMutation: vi.fn().mockResolvedValue(undefined),
    } as unknown as RunCtx;

    await closeAccount(asStripe(stripe), makeComponent(), ctx, {
      stripeAccountId: "acct_fb",
    });

    expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledWith("acct_fb");
    expect(stripe.v2.core.accounts.close).toHaveBeenCalledWith("acct_fb", {
      applied_configurations: ["merchant"],
    });
  });

  it("closes with an empty config list when the Stripe retrieve fallback throws", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockRejectedValue(
      new Error("no such account"),
    );
    stripe.v2.core.accounts.close.mockResolvedValue({});
    const ctx = {
      runQuery: vi.fn().mockResolvedValue(null),
      runMutation: vi.fn().mockResolvedValue(undefined),
    } as unknown as RunCtx;

    await closeAccount(asStripe(stripe), makeComponent(), ctx, {
      stripeAccountId: "acct_missing",
    });

    expect(stripe.v2.core.accounts.close).toHaveBeenCalledWith("acct_missing", {
      applied_configurations: [],
    });
  });

  it("does not delete from the DB if the Stripe close fails", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.close.mockRejectedValue(new Error("close boom"));
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({ appliedConfigurations: ["merchant"] }),
      runMutation,
    } as unknown as RunCtx;

    await expect(
      closeAccount(asStripe(stripe), makeComponent(), ctx, {
        stripeAccountId: "acct_err",
      }),
    ).rejects.toThrow(/close boom/);

    expect(runMutation).not.toHaveBeenCalled();
  });

  it("restartAccountOnboarding delegates to closeAccount", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.close.mockResolvedValue({});
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({ appliedConfigurations: [] }),
      runMutation: vi.fn().mockResolvedValue(undefined),
    } as unknown as RunCtx;

    const result = await restartAccountOnboarding(
      asStripe(stripe),
      makeComponent(),
      ctx,
      { stripeAccountId: "acct_restart" },
    );

    expect(result).toEqual({ closed: true });
    expect(stripe.v2.core.accounts.close).toHaveBeenCalledWith("acct_restart", {
      applied_configurations: [],
    });
  });
});

describe("syncAllAccounts", () => {
  it("maps a business V2 account into an upsert and counts it synced", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list.mockResolvedValueOnce({
      data: [
        {
          id: "acct_biz",
          contact_email: "biz@co.com",
          metadata: { userId: "u_biz", orgId: "o_biz" },
          identity: {
            country: "US",
            business_details: { registered_name: "Big Co" },
          },
          configuration: { merchant: { applied: true } },
          requirements: { entries: [] },
        },
      ],
      has_more: false,
    });
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = { runMutation, runQuery: vi.fn() } as unknown as RunCtx;

    const result = await syncAllAccounts(asStripe(stripe), makeComponent(), ctx);

    expect(result).toEqual({ synced: 1, errors: [], errorCount: 0 });

    const upsertArg = runMutation.mock.calls[0][1];
    expect(upsertArg).toMatchObject({
      stripeAccountId: "acct_biz",
      userId: "u_biz",
      orgId: "o_biz",
      email: "biz@co.com",
      name: "Big Co",
      country: "US",
      onboardingStatus: "complete",
      missingRequirements: [],
      metadata: { userId: "u_biz", orgId: "o_biz" },
    });
    // list called with limit 20
    expect(stripe.v2.core.accounts.list.mock.calls[0][0]).toEqual({ limit: 20 });
  });

  it("derives an individual name, falls back to contact email, and accepts snake_case ids", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list.mockResolvedValueOnce({
      data: [
        {
          id: "acct_ind",
          metadata: { user_id: "u_snake", org_id: "o_snake" },
          identity: {
            country: "CA",
            individual: {
              given_name: "Jane",
              surname: "Doe",
              email: "jane@x.com",
            },
          },
        },
      ],
      has_more: false,
    });
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = { runMutation, runQuery: vi.fn() } as unknown as RunCtx;

    await syncAllAccounts(asStripe(stripe), makeComponent(), ctx);

    const upsertArg = runMutation.mock.calls[0][1];
    expect(upsertArg).toMatchObject({
      userId: "u_snake",
      orgId: "o_snake",
      email: "jane@x.com", // individual.email fallback (no contact_email)
      name: "Jane Doe", // given_name + surname
      country: "CA",
    });
  });

  it("falls back to the account id as userId when metadata has none", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list.mockResolvedValueOnce({
      data: [{ id: "acct_noid" }],
      has_more: false,
    });
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = { runMutation, runQuery: vi.fn() } as unknown as RunCtx;

    await syncAllAccounts(asStripe(stripe), makeComponent(), ctx);

    const upsertArg = runMutation.mock.calls[0][1];
    expect(upsertArg.userId).toBe("acct_noid");
    expect(upsertArg.orgId).toBeUndefined();
    expect(upsertArg.email).toBeUndefined();
    expect(upsertArg.name).toBeUndefined();
  });

  it("accumulates a per-account error instead of aborting the sync", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list.mockResolvedValueOnce({
      data: [
        { id: "acct_ok", metadata: { userId: "ok" } },
        { id: "acct_bad", metadata: { userId: "bad" } },
      ],
      has_more: false,
    });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(undefined) // acct_ok
      .mockRejectedValueOnce(new Error("db down")); // acct_bad
    const ctx = { runMutation, runQuery: vi.fn() } as unknown as RunCtx;

    const result = await syncAllAccounts(asStripe(stripe), makeComponent(), ctx);

    expect(result.synced).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0]).toContain("acct_bad");
    expect(result.errors[0]).toContain("db down");
  });

  it("stringifies a non-Error thrown value as 'Unknown error'", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list.mockResolvedValueOnce({
      data: [{ id: "acct_weird", metadata: { userId: "u" } }],
      has_more: false,
    });
    const runMutation = vi.fn().mockRejectedValueOnce("not-an-error-object");
    const ctx = { runMutation, runQuery: vi.fn() } as unknown as RunCtx;

    const result = await syncAllAccounts(asStripe(stripe), makeComponent(), ctx);

    expect(result.errorCount).toBe(1);
    expect(result.errors[0]).toBe("Account acct_weird: Unknown error");
  });

  it("leaves name undefined for an individual with no given_name or surname", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list.mockResolvedValueOnce({
      data: [
        {
          id: "acct_blank",
          metadata: { userId: "u" },
          identity: { individual: { email: "only@email.com" } },
        },
      ],
      has_more: false,
    });
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = { runMutation, runQuery: vi.fn() } as unknown as RunCtx;

    await syncAllAccounts(asStripe(stripe), makeComponent(), ctx);

    const upsertArg = runMutation.mock.calls[0][1];
    expect(upsertArg.name).toBeUndefined();
    expect(upsertArg.email).toBe("only@email.com");
  });

  it("paginates with starting_after across multiple pages", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list
      .mockResolvedValueOnce({
        data: [{ id: "acct_p1", metadata: { userId: "u1" } }],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [{ id: "acct_p2", metadata: { userId: "u2" } }],
        has_more: false,
      });
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = { runMutation, runQuery: vi.fn() } as unknown as RunCtx;

    const result = await syncAllAccounts(asStripe(stripe), makeComponent(), ctx);

    expect(result.synced).toBe(2);
    expect(stripe.v2.core.accounts.list.mock.calls[1][0]).toEqual({
      limit: 20,
      starting_after: "acct_p1",
    });
  });

  it("terminates on an empty first page", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.list.mockResolvedValueOnce({
      data: [],
      has_more: true,
    });
    const ctx = {
      runMutation: vi.fn(),
      runQuery: vi.fn(),
    } as unknown as RunCtx;

    const result = await syncAllAccounts(asStripe(stripe), makeComponent(), ctx);

    expect(result).toEqual({ synced: 0, errors: [], errorCount: 0 });
    expect(stripe.v2.core.accounts.list).toHaveBeenCalledTimes(1);
  });
});
