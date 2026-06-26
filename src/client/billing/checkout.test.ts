/**
 * Tests for the checkout-session methods. `createCheckoutSession` carries the
 * real branching logic — embedded vs redirect ui_mode, the
 * subscription/payment/setup mode-specific blocks, metadata + orgId assembly,
 * the accountId-vs-customerEmail precedence, default quantity, sessionOverrides
 * spreading, and the component upsert with its null-coalescing defaults — so it
 * gets the most attention. The remaining functions are thin component/Stripe
 * wrappers verified for param shape and pass-through.
 */
import { describe, expect, it, vi } from "vitest";

import type { Component, RunCtx } from "../helpers.js";
import {
  createCheckoutSession,
  getCheckoutSession,
  getCheckoutSessionByStripeId,
  listCheckoutSessionsByUser,
  updateCheckoutSession,
  upsertCheckoutSession,
} from "./checkout.js";

const TO_REF = Symbol.for("toReferencePath");

/** Component proxy exposing the billing refs these functions resolve. */
function makeComponent(): Component {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    billing: {
      queries: {
        getCheckoutSession: ref("billing/queries/getCheckoutSession"),
        getCheckoutSessionByStripeId: ref(
          "billing/queries/getCheckoutSessionByStripeId",
        ),
        listCheckoutSessionsByUser: ref(
          "billing/queries/listCheckoutSessionsByUser",
        ),
      },
      mutations: {
        upsertCheckoutSession: ref("billing/mutations/upsertCheckoutSession"),
      },
    },
  } as unknown as Component;
}

function makeCtx(queryResult?: unknown) {
  return {
    runQuery: vi.fn().mockResolvedValue(queryResult),
    runMutation: vi.fn().mockResolvedValue(undefined),
  } as unknown as RunCtx & {
    runQuery: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  };
}

function makeStripe() {
  return {
    checkout: {
      sessions: {
        create: vi.fn(),
        update: vi.fn(),
      },
    },
  };
}

const asStripe = (s: ReturnType<typeof makeStripe>) =>
  s as unknown as Parameters<typeof createCheckoutSession>[0];

/** Default Stripe session response used when a test does not care about it. */
function sessionResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_1",
    status: "open",
    client_secret: "cs_secret_1",
    url: null,
    ...overrides,
  };
}

describe("createCheckoutSession", () => {
  it("builds a subscription embedded session and upserts the resulting row", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(
      sessionResponse({ id: "cs_sub", client_secret: "secret_sub", url: null }),
    );
    const ctx = makeCtx();

    const result = await createCheckoutSession(
      asStripe(stripe),
      makeComponent(),
      ctx,
      {
        userId: "user_1",
        orgId: "org_1",
        stripePriceId: "price_1",
        mode: "subscription",
        returnUrl: "https://app.test/return",
      },
    );

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    // metadata includes userId + orgId; line_items default quantity 1
    expect(createArg.metadata).toEqual({ userId: "user_1", orgId: "org_1" });
    expect(createArg.line_items).toEqual([{ price: "price_1", quantity: 1 }]);
    expect(createArg.mode).toBe("subscription");
    // subscription mode → subscription_data carries the same metadata
    expect(createArg.subscription_data).toEqual({
      metadata: { userId: "user_1", orgId: "org_1" },
    });
    expect(createArg.subscription_data.trial_period_days).toBeUndefined();
    // no payment_intent_data for subscription mode
    expect(createArg.payment_intent_data).toBeUndefined();
    // embedded ui_mode is the default
    expect(createArg.ui_mode).toBe("embedded_page");
    expect(createArg.return_url).toBe("https://app.test/return");
    expect(createArg.success_url).toBeUndefined();
    expect(createArg.cancel_url).toBeUndefined();

    // upsert mutation carries derived row
    const [, upsertArgs] = ctx.runMutation.mock.calls[0];
    expect(upsertArgs).toMatchObject({
      stripeSessionId: "cs_sub",
      userId: "user_1",
      orgId: "org_1",
      mode: "subscription",
      status: "open",
      clientSecret: "secret_sub",
      metadata: { userId: "user_1", orgId: "org_1" },
    });
    expect(upsertArgs.url).toBeUndefined();

    expect(result).toEqual({
      stripeSessionId: "cs_sub",
      clientSecret: "secret_sub",
      url: undefined,
    });
  });

  it("adds trial_period_days to subscription_data when trialDays is set", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      stripePriceId: "price_1",
      mode: "subscription",
      returnUrl: "https://app.test/return",
      trialDays: 14,
    });

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(createArg.subscription_data.trial_period_days).toBe(14);
  });

  it("omits orgId from metadata when not provided", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_solo",
      stripePriceId: "price_1",
      mode: "subscription",
      returnUrl: "https://app.test/return",
    });

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(createArg.metadata).toEqual({ userId: "user_solo" });
    expect(createArg.metadata.orgId).toBeUndefined();
    const [, upsertArgs] = ctx.runMutation.mock.calls[0];
    expect(upsertArgs.orgId).toBeUndefined();
  });

  it("merges caller metadata with the userId/orgId identifiers", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      orgId: "org_1",
      stripePriceId: "price_1",
      mode: "subscription",
      returnUrl: "https://app.test/return",
      metadata: { plan: "pro", source: "pricing-page" },
    });

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(createArg.metadata).toEqual({
      plan: "pro",
      source: "pricing-page",
      userId: "user_1",
      orgId: "org_1",
    });
  });

  it("uses payment_intent_data and redirect urls for a payment redirect session", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(
      sessionResponse({ id: "cs_pay" }),
    );
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      stripePriceId: "price_1",
      mode: "payment",
      uiMode: "redirect",
      returnUrl: "https://app.test/done",
    });

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    // payment mode → payment_intent_data; no subscription_data
    expect(createArg.payment_intent_data).toEqual({
      metadata: { userId: "user_1" },
    });
    expect(createArg.subscription_data).toBeUndefined();
    // redirect ui_mode → success/cancel urls, no embedded fields
    expect(createArg.ui_mode).toBeUndefined();
    expect(createArg.return_url).toBeUndefined();
    expect(createArg.success_url).toBe(
      "https://app.test/done?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(createArg.cancel_url).toBe("https://app.test/done");
  });

  it("emits neither subscription_data nor payment_intent_data for setup mode", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      stripePriceId: "price_1",
      mode: "setup",
      returnUrl: "https://app.test/return",
    });

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(createArg.subscription_data).toBeUndefined();
    expect(createArg.payment_intent_data).toBeUndefined();
    expect(createArg.mode).toBe("setup");
  });

  it("forwards an explicit quantity to line_items", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      stripePriceId: "price_seat",
      mode: "subscription",
      returnUrl: "https://app.test/return",
      quantity: 5,
    });

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(createArg.line_items).toEqual([{ price: "price_seat", quantity: 5 }]);
  });

  it("sets customer_account when accountId is provided", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      stripePriceId: "price_1",
      mode: "subscription",
      returnUrl: "https://app.test/return",
      accountId: "acct_123",
      customerEmail: "ignored@test.com",
    });

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    // accountId takes precedence over customerEmail
    expect(createArg.customer_account).toBe("acct_123");
    expect(createArg.customer_email).toBeUndefined();
    const [, upsertArgs] = ctx.runMutation.mock.calls[0];
    expect(upsertArgs.accountId).toBe("acct_123");
  });

  it("falls back to customer_email when no accountId is given", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      stripePriceId: "price_1",
      mode: "subscription",
      returnUrl: "https://app.test/return",
      customerEmail: "buyer@test.com",
    });

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(createArg.customer_email).toBe("buyer@test.com");
    expect(createArg.customer_account).toBeUndefined();
  });

  it("sets neither customer field when both accountId and email are absent", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      stripePriceId: "price_1",
      mode: "subscription",
      returnUrl: "https://app.test/return",
    });

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(createArg.customer_account).toBeUndefined();
    expect(createArg.customer_email).toBeUndefined();
  });

  it("spreads sessionOverrides over the computed params", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      stripePriceId: "price_1",
      mode: "subscription",
      returnUrl: "https://app.test/return",
      sessionOverrides: {
        allow_promotion_codes: true,
        mode: "payment", // override wins over computed mode
      },
    });

    const createArg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(createArg.allow_promotion_codes).toBe(true);
    expect(createArg.mode).toBe("payment");
  });

  it("defaults status to 'open' and url/clientSecret to undefined when Stripe returns nullish values", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_minimal",
      status: null,
      client_secret: null,
      url: null,
    });
    const ctx = makeCtx();

    const result = await createCheckoutSession(
      asStripe(stripe),
      makeComponent(),
      ctx,
      {
        userId: "user_1",
        stripePriceId: "price_1",
        mode: "subscription",
        returnUrl: "https://app.test/return",
      },
    );

    const [, upsertArgs] = ctx.runMutation.mock.calls[0];
    expect(upsertArgs.status).toBe("open");
    expect(upsertArgs.clientSecret).toBeUndefined();
    expect(upsertArgs.url).toBeUndefined();
    expect(result).toEqual({
      stripeSessionId: "cs_minimal",
      clientSecret: undefined,
      url: undefined,
    });
  });

  it("propagates the redirect url returned by Stripe into the upsert and result", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(
      sessionResponse({
        id: "cs_redir",
        status: "complete",
        client_secret: null,
        url: "https://checkout.stripe.com/c/pay/cs_redir",
      }),
    );
    const ctx = makeCtx();

    const result = await createCheckoutSession(
      asStripe(stripe),
      makeComponent(),
      ctx,
      {
        userId: "user_1",
        stripePriceId: "price_1",
        mode: "payment",
        uiMode: "redirect",
        returnUrl: "https://app.test/done",
      },
    );

    const [, upsertArgs] = ctx.runMutation.mock.calls[0];
    expect(upsertArgs.status).toBe("complete");
    expect(upsertArgs.url).toBe("https://checkout.stripe.com/c/pay/cs_redir");
    expect(result.url).toBe("https://checkout.stripe.com/c/pay/cs_redir");
    expect(result.clientSecret).toBeUndefined();
  });

  it("persists the price id on the upserted checkout-session row", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(
      sessionResponse({ id: "cs_priced" }),
    );
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      stripePriceId: "price_pro_monthly",
      mode: "subscription",
      returnUrl: "https://app.test/return",
    });

    const [, upsertArgs] = ctx.runMutation.mock.calls[0];
    expect(upsertArgs.priceId).toBe("price_pro_monthly");
  });

  it("targets the upsertCheckoutSession component ref", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = makeCtx();

    await createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
      userId: "user_1",
      stripePriceId: "price_1",
      mode: "subscription",
      returnUrl: "https://app.test/return",
    });

    const [ref] = ctx.runMutation.mock.calls[0];
    expect(ref).toEqual({
      [TO_REF]: "betterStripe/billing/mutations/upsertCheckoutSession",
    });
  });

  it("throws when ctx has no runMutation (runMutationOrThrow guard)", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue(sessionResponse());
    const ctx = { runQuery: vi.fn() } as unknown as RunCtx;

    await expect(
      createCheckoutSession(asStripe(stripe), makeComponent(), ctx, {
        userId: "user_1",
        stripePriceId: "price_1",
        mode: "subscription",
        returnUrl: "https://app.test/return",
      }),
    ).rejects.toThrow(/requires a Convex ctx with runMutation/);
  });
});

describe("getCheckoutSession", () => {
  it("queries by internal session id and returns the row", async () => {
    const ctx = makeCtx({ stripeSessionId: "cs_1" });
    const result = await getCheckoutSession(makeComponent(), ctx, {
      sessionId: "internal_1",
    });

    expect(result).toEqual({ stripeSessionId: "cs_1" });
    const [ref, args] = ctx.runQuery.mock.calls[0];
    expect(ref).toEqual({
      [TO_REF]: "betterStripe/billing/queries/getCheckoutSession",
    });
    expect(args).toEqual({ sessionId: "internal_1" });
  });

  it("returns null when the session does not exist", async () => {
    const ctx = makeCtx(null);
    const result = await getCheckoutSession(makeComponent(), ctx, {
      sessionId: "missing",
    });
    expect(result).toBeNull();
  });
});

describe("getCheckoutSessionByStripeId", () => {
  it("queries by stripe session id and returns the row", async () => {
    const ctx = makeCtx({ stripeSessionId: "cs_abc" });
    const result = await getCheckoutSessionByStripeId(makeComponent(), ctx, {
      stripeSessionId: "cs_abc",
    });

    expect(result).toEqual({ stripeSessionId: "cs_abc" });
    const [ref, args] = ctx.runQuery.mock.calls[0];
    expect(ref).toEqual({
      [TO_REF]: "betterStripe/billing/queries/getCheckoutSessionByStripeId",
    });
    expect(args).toEqual({ stripeSessionId: "cs_abc" });
  });
});

describe("listCheckoutSessionsByUser", () => {
  it("forwards userId and optional status filter and returns the rows", async () => {
    const ctx = makeCtx([{ stripeSessionId: "cs_a" }, { stripeSessionId: "cs_b" }]);
    const result = await listCheckoutSessionsByUser(makeComponent(), ctx, {
      userId: "user_1",
      status: "complete",
    });

    expect(result).toHaveLength(2);
    const [ref, args] = ctx.runQuery.mock.calls[0];
    expect(ref).toEqual({
      [TO_REF]: "betterStripe/billing/queries/listCheckoutSessionsByUser",
    });
    expect(args).toEqual({ userId: "user_1", status: "complete" });
  });
});

describe("upsertCheckoutSession", () => {
  it("runs the upsert mutation with the given opts and returns null", async () => {
    const ctx = makeCtx();
    const result = await upsertCheckoutSession(makeComponent(), ctx, {
      stripeSessionId: "cs_up",
      userId: "user_1",
      mode: "payment",
      status: "complete",
    });

    expect(result).toBeNull();
    const [ref, args] = ctx.runMutation.mock.calls[0];
    expect(ref).toEqual({
      [TO_REF]: "betterStripe/billing/mutations/upsertCheckoutSession",
    });
    expect(args).toEqual({
      stripeSessionId: "cs_up",
      userId: "user_1",
      mode: "payment",
      status: "complete",
    });
  });

  it("throws when ctx has no runMutation", async () => {
    const ctx = { runQuery: vi.fn() } as unknown as RunCtx;
    await expect(
      upsertCheckoutSession(makeComponent(), ctx, {
        stripeSessionId: "cs_up",
        userId: "user_1",
        mode: "payment",
        status: "complete",
      }),
    ).rejects.toThrow(/requires a Convex ctx with runMutation/);
  });
});

describe("updateCheckoutSession", () => {
  it("updates the Stripe session metadata and returns the session", async () => {
    const stripe = makeStripe();
    const updated = { id: "cs_u", metadata: { plan: "pro" } };
    stripe.checkout.sessions.update.mockResolvedValue(updated);
    const ctx = makeCtx();

    const result = await updateCheckoutSession(asStripe(stripe), ctx, {
      stripeSessionId: "cs_u",
      metadata: { plan: "pro" },
    });

    expect(stripe.checkout.sessions.update).toHaveBeenCalledWith("cs_u", {
      metadata: { plan: "pro" },
    });
    expect(result).toBe(updated);
  });

  it("passes undefined metadata through when none is provided", async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.update.mockResolvedValue({ id: "cs_u2" });
    const ctx = makeCtx();

    await updateCheckoutSession(asStripe(stripe), ctx, {
      stripeSessionId: "cs_u2",
    });

    expect(stripe.checkout.sessions.update).toHaveBeenCalledWith("cs_u2", {
      metadata: undefined,
    });
  });
});
