/**
 * Tests for the account-link / session / portal helpers.
 *
 * These functions are thin wrappers over the Stripe SDK, so we mock the SDK
 * surface and assert (a) the exact params we hand Stripe and (b) the shape we
 * return. `getAccountLinkWithStatus` carries the real logic — a 3-way branch
 * plus a silent login-link → onboarding fallback — so it gets branch-complete
 * coverage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RunCtx } from "../helpers.js";
import {
  createAccountLink,
  createAccountSession,
  createDisputeSession,
  createBillingPortalSession,
  createLoginLink,
  createV2AccountLink,
  getAccountLinkWithStatus,
  getCountrySpecs,
} from "./accountLinks.js";

// ctx is unused by every function here (params are named `_ctx`), so an empty
// object cast to RunCtx is sufficient and keeps the tests focused on Stripe I/O.
const ctx = {} as unknown as RunCtx;

/** Build a mock Stripe instance exposing only the methods these helpers touch. */
function makeStripe() {
  return {
    accountLinks: { create: vi.fn() },
    accountSessions: { create: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
    countrySpecs: { retrieve: vi.fn() },
    accounts: { createLoginLink: vi.fn() },
    v2: {
      core: {
        accounts: { retrieve: vi.fn() },
        accountLinks: { create: vi.fn() },
      },
    },
  };
}

type MockStripe = ReturnType<typeof makeStripe>;

// Cast helper — the mock only implements the slice of Stripe these functions use.
const asStripe = (s: MockStripe) => s as unknown as Parameters<typeof createAccountLink>[0];

describe("createAccountLink", () => {
  it("passes through params and returns the url", async () => {
    const stripe = makeStripe();
    stripe.accountLinks.create.mockResolvedValue({ url: "https://link" });

    const result = await createAccountLink(asStripe(stripe), ctx, {
      stripeAccountId: "acct_1",
      refreshUrl: "https://refresh",
      returnUrl: "https://return",
      type: "account_onboarding",
    });

    expect(result).toEqual({ url: "https://link" });
    expect(stripe.accountLinks.create).toHaveBeenCalledWith({
      account: "acct_1",
      refresh_url: "https://refresh",
      return_url: "https://return",
      type: "account_onboarding",
    });
  });
});

describe("createV2AccountLink", () => {
  it("builds an account_onboarding use_case and returns url + expiresAt", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accountLinks.create.mockResolvedValue({
      url: "https://v2",
      expires_at: "2030-01-01T00:00:00Z",
    });

    const result = await createV2AccountLink(asStripe(stripe), ctx, {
      stripeAccountId: "acct_2",
      type: "account_onboarding",
      refreshUrl: "https://refresh",
      returnUrl: "https://return",
      configurations: ["merchant"],
    });

    expect(result).toEqual({
      url: "https://v2",
      expiresAt: "2030-01-01T00:00:00Z",
    });
    expect(stripe.v2.core.accountLinks.create).toHaveBeenCalledWith({
      account: "acct_2",
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          refresh_url: "https://refresh",
          return_url: "https://return",
        },
      },
    });
  });

  it("builds an account_update use_case when type is account_update", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accountLinks.create.mockResolvedValue({
      url: "https://v2",
      expires_at: "2030-01-01T00:00:00Z",
    });

    await createV2AccountLink(asStripe(stripe), ctx, {
      stripeAccountId: "acct_3",
      type: "account_update",
      refreshUrl: "https://refresh",
      returnUrl: "https://return",
      configurations: ["recipient"],
    });

    expect(stripe.v2.core.accountLinks.create).toHaveBeenCalledWith({
      account: "acct_3",
      use_case: {
        type: "account_update",
        account_update: {
          configurations: ["recipient"],
          refresh_url: "https://refresh",
          return_url: "https://return",
        },
      },
    });
  });

  it("defaults configurations to an empty array for account_update too", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accountLinks.create.mockResolvedValue({
      url: "https://v2",
      expires_at: null,
    });

    await createV2AccountLink(asStripe(stripe), ctx, {
      stripeAccountId: "acct_4b",
      type: "account_update",
      refreshUrl: "https://refresh",
      returnUrl: "https://return",
    });

    const arg = stripe.v2.core.accountLinks.create.mock.calls[0][0];
    expect(arg.use_case.account_update.configurations).toEqual([]);
  });

  it("defaults configurations to an empty array when omitted", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accountLinks.create.mockResolvedValue({
      url: "https://v2",
      expires_at: null,
    });

    await createV2AccountLink(asStripe(stripe), ctx, {
      stripeAccountId: "acct_4",
      type: "account_onboarding",
      refreshUrl: "https://refresh",
      returnUrl: "https://return",
    });

    const arg = stripe.v2.core.accountLinks.create.mock.calls[0][0];
    expect(arg.use_case.account_onboarding.configurations).toEqual([]);
  });
});

describe("createAccountSession", () => {
  it("returns the client secret on success", async () => {
    const stripe = makeStripe();
    stripe.accountSessions.create.mockResolvedValue({
      client_secret: "secret_123",
    });

    const result = await createAccountSession(asStripe(stripe), ctx, {
      stripeAccountId: "acct_5",
      components: { account_onboarding: { enabled: true } },
    });

    expect(result).toEqual({ clientSecret: "secret_123" });
    expect(stripe.accountSessions.create).toHaveBeenCalledWith({
      account: "acct_5",
      components: { account_onboarding: { enabled: true } },
    });
  });

  it("throws STRIPE_API_ERROR when Stripe rejects", async () => {
    const stripe = makeStripe();
    stripe.accountSessions.create.mockRejectedValue({
      type: "StripeInvalidRequestError",
      code: "resource_missing",
      message: "No such account",
    });

    await expect(
      createAccountSession(asStripe(stripe), ctx, {
        stripeAccountId: "acct_missing",
        components: {},
      }),
    ).rejects.toMatchObject({
      data: {
        code: "STRIPE_API_ERROR",
        stripeError: { type: "StripeInvalidRequestError" },
      },
    });
  });
});

describe("createLoginLink", () => {
  it("returns the login link url", async () => {
    const stripe = makeStripe();
    stripe.accounts.createLoginLink.mockResolvedValue({ url: "https://login" });

    const result = await createLoginLink(asStripe(stripe), ctx, {
      stripeAccountId: "acct_6",
    });

    expect(result).toEqual({ url: "https://login" });
    expect(stripe.accounts.createLoginLink).toHaveBeenCalledWith("acct_6");
  });
});

describe("createBillingPortalSession", () => {
  it("creates a portal session keyed by customer_account", async () => {
    const stripe = makeStripe();
    stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://portal",
    });

    const result = await createBillingPortalSession(asStripe(stripe), ctx, {
      stripeAccountId: "acct_7",
      returnUrl: "https://return",
    });

    expect(result).toEqual({ url: "https://portal" });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer_account: "acct_7",
      return_url: "https://return",
    });
  });
});

describe("getCountrySpecs", () => {
  it("retrieves the country spec by code", async () => {
    const stripe = makeStripe();
    stripe.countrySpecs.retrieve.mockResolvedValue({ id: "US" });

    const result = await getCountrySpecs(asStripe(stripe), ctx, {
      countryCode: "US",
    });

    expect(result).toEqual({ id: "US" });
    expect(stripe.countrySpecs.retrieve).toHaveBeenCalledWith("US");
  });
});

describe("getAccountLinkWithStatus", () => {
  const opts = {
    stripeAccountId: "acct_8",
    refreshUrl: "https://refresh",
    returnUrl: "https://return",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an onboarding link when the account has outstanding requirements", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue({
      requirements: { entries: [{ description: "business_url" }] },
      applied_configurations: ["merchant"],
    });
    stripe.v2.core.accountLinks.create.mockResolvedValue({
      url: "https://onboard",
      expires_at: null,
    });

    const result = await getAccountLinkWithStatus(asStripe(stripe), ctx, opts);

    expect(result).toEqual({ url: "https://onboard", linkType: "onboarding" });
    // login link must NOT be used while requirements are outstanding
    expect(stripe.accounts.createLoginLink).not.toHaveBeenCalled();
    // applied_configurations should flow into the onboarding link
    const arg = stripe.v2.core.accountLinks.create.mock.calls[0][0];
    expect(arg.use_case.account_onboarding.configurations).toEqual(["merchant"]);
  });

  it("returns a login link for an express dashboard account with no requirements", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue({
      requirements: { entries: [] },
      dashboard: "express",
    });
    stripe.accounts.createLoginLink.mockResolvedValue({ url: "https://login" });

    const result = await getAccountLinkWithStatus(asStripe(stripe), ctx, opts);

    expect(result).toEqual({ url: "https://login", linkType: "login" });
    expect(stripe.v2.core.accountLinks.create).not.toHaveBeenCalled();
  });

  it("falls back to an onboarding link when the express login link fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue({
      requirements: { entries: [] },
      dashboard: "express",
    });
    stripe.accounts.createLoginLink.mockRejectedValue(new Error("boom"));
    stripe.v2.core.accountLinks.create.mockResolvedValue({
      url: "https://onboard",
      expires_at: null,
    });

    const result = await getAccountLinkWithStatus(asStripe(stripe), ctx, opts);

    expect(result).toEqual({ url: "https://onboard", linkType: "onboarding" });
    expect(warn).toHaveBeenCalled();
  });

  it("returns an onboarding link for a non-express account with no requirements", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue({
      requirements: { entries: [] },
      dashboard: "full",
    });
    stripe.v2.core.accountLinks.create.mockResolvedValue({
      url: "https://onboard",
      expires_at: null,
    });

    const result = await getAccountLinkWithStatus(asStripe(stripe), ctx, opts);

    expect(result).toEqual({ url: "https://onboard", linkType: "onboarding" });
    expect(stripe.accounts.createLoginLink).not.toHaveBeenCalled();
  });

  it("treats a missing requirements object as no requirements", async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.retrieve.mockResolvedValue({
      dashboard: "full",
    });
    stripe.v2.core.accountLinks.create.mockResolvedValue({
      url: "https://onboard",
      expires_at: null,
    });

    const result = await getAccountLinkWithStatus(asStripe(stripe), ctx, opts);

    expect(result.linkType).toBe("onboarding");
    const arg = stripe.v2.core.accountLinks.create.mock.calls[0][0];
    // applied_configurations absent → defaults to []
    expect(arg.use_case.account_onboarding.configurations).toEqual([]);
  });
});

describe("createDisputeSession (BTS-30)", () => {
  it("creates an account session with the disputes components for the seller", async () => {
    const stripe = makeStripe();
    stripe.accountSessions.create.mockResolvedValue({ client_secret: "acs_secret" });

    const result = await createDisputeSession(asStripe(stripe), {} as RunCtx, {
      stripeAccountId: "acct_seller",
    });

    expect(stripe.accountSessions.create).toHaveBeenCalledWith({
      account: "acct_seller",
      components: {
        disputes_list: { enabled: true },
        payment_disputes: { enabled: true },
      },
    });
    expect(result).toEqual({ clientSecret: "acs_secret" });
  });
})
