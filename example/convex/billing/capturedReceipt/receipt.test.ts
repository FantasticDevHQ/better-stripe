// @vitest-environment edge-runtime
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  capturedRead,
  capturedReceiptFixture,
  capturedSession,
  hasCapturedReceiptAction,
} from "../../../testing/capturedReceiptFixture";
import { stripe } from "../../stripe/helpers";

vi.hoisted(() =>
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_captured_receipt_unit"),
);
beforeEach(() =>
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_captured_receipt_unit"),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function requireCapturedReceiptAction() {
  // A missing feature is an assertion failure; it is not a resolver/setup error.
  expect(
    hasCapturedReceiptAction(),
    "Register the ctx.auth-authorized captured receipt action before these integration assertions",
  ).toBe(true);
}

it("registers a real authenticated captured Checkout receipt read", () => {
  requireCapturedReceiptAction();
});

it("rejects the default anonymous demo even when its buyer persona exists", async () => {
  requireCapturedReceiptAction();
  const f = await capturedReceiptFixture();
  const before = await f.snapshot();
  await expect(
    f.t.action(capturedRead, { stripeSessionId: f.sessionId }),
  ).rejects.toThrow("Authentication required");
  expect(f.transport).not.toHaveBeenCalled();
  expect(f.expandedRead).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
});

it.each(["missing", "duplicate", "visitor"] as const)(
  "rejects %s token-to-buyer mapping before provider access",
  async (mapping) => {
    requireCapturedReceiptAction();
    const f = await capturedReceiptFixture();
    if (mapping === "duplicate")
      await f.t.run((ctx) =>
        ctx.db.insert("users", {
          name: "Duplicate buyer",
          email: "duplicate@example.invalid",
          role: "buyer",
          authTokenIdentifier: "captured_original_token",
        }),
      );
    if (mapping === "visitor")
      await f.t.run((ctx) =>
        ctx.db.patch("users", f.userId, { role: "visitor" }),
      );
    const caller =
      mapping === "missing"
        ? f.t.withIdentity({ subject: "missing", tokenIdentifier: "missing" })
        : f.caller;
    const before = await f.snapshot();
    await expect(
      caller.action(capturedRead, { stripeSessionId: f.sessionId }),
    ).rejects.toThrow("Authentication required");
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.expandedRead).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  },
);

it.each([
  "foreign-session",
  "foreign-account",
  "org-session",
  "org-account",
] as const)(
  "rejects %s original ownership before provider access",
  async (scope) => {
    requireCapturedReceiptAction();
    const f = await capturedReceiptFixture();
    await f.t.run(async (ctx) => {
      if (scope === "foreign-session" || scope === "org-session")
        await stripe.upsertCheckoutSession(ctx, {
          stripeSessionId: f.sessionId,
          userId: scope === "foreign-session" ? "foreign_buyer" : f.userId,
          accountId: f.accountId,
          mode: "payment",
          status: "complete",
          ...(scope === "org-session" ? { orgId: "foreign_org" } : {}),
        });
      else
        await stripe.upsertAccount(ctx, {
          stripeAccountId: f.accountId,
          userId: scope === "foreign-account" ? "foreign_buyer" : f.userId,
          ...(scope === "org-account" ? { orgId: "foreign_org" } : {}),
        });
    });
    f.write.mockClear();
    const before = await f.snapshot();
    await expect(
      f.caller.action(capturedRead, { stripeSessionId: f.sessionId }),
    ).rejects.toThrow("Authentication required");
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.expandedRead).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  },
);

it("binds the authorized original Session/account before one expanded SDK read and exposes only a safe capture", async () => {
  requireCapturedReceiptAction();
  const f = await capturedReceiptFixture();
  const before = await f.snapshot();
  const result = await f.caller.action(capturedRead, {
    stripeSessionId: f.sessionId,
  });
  expect(f.accountRead).toHaveBeenCalledWith(expect.anything(), {
    stripeAccountId: f.accountId,
    requireUnique: true,
  });
  expect(f.expandedRead).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    stripeSessionId: f.sessionId,
    expand: ["payment_intent.latest_charge"],
  });
  expect(f.transport).toHaveBeenCalledTimes(1);
  expect(result).toEqual({
    status: "ready",
    stripeSessionId: f.sessionId,
    stripePaymentIntentId: "pi_captured_original",
    stripeChargeId: "ch_captured_original",
    customerAccountId: f.accountId,
    livemode: false,
    amount: 3500,
    currency: "usd",
  });
  expect(JSON.stringify(result)).not.toContain("private_");
  expect(f.write).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
});

it("rejects an ambiguous original account instead of adopting its first row", async () => {
  requireCapturedReceiptAction();
  const f = await capturedReceiptFixture();
  await f.duplicateAccount();
  const before = await f.snapshot();
  await expect(
    f.caller.action(capturedRead, { stripeSessionId: f.sessionId }),
  ).rejects.toThrow("Authentication required");
  expect(f.accountRead).toHaveBeenCalledWith(expect.anything(), {
    stripeAccountId: f.accountId,
    requireUnique: true,
  });
  expect(f.transport).not.toHaveBeenCalled();
  expect(f.expandedRead).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
});

it.each([
  "missing-session",
  "missing-account",
  "subscription",
  "blank-account",
] as const)(
  "rejects %s original context before provider access",
  async (kind) => {
    requireCapturedReceiptAction();
    const f = await capturedReceiptFixture();
    if (kind !== "missing-session")
      await f.t.run((ctx) =>
        stripe.upsertCheckoutSession(ctx, {
          stripeSessionId: f.sessionId,
          userId: f.userId,
          accountId:
            kind === "missing-account"
              ? "acct_missing"
              : kind === "blank-account"
                ? " "
                : f.accountId,
          mode: kind === "subscription" ? "subscription" : "payment",
          status: "complete",
        }),
      );
    f.write.mockClear();
    const before = await f.snapshot();
    await expect(
      f.caller.action(capturedRead, {
        stripeSessionId:
          kind === "missing-session" ? "cs_missing" : f.sessionId,
      }),
    ).rejects.toThrow("Authentication required");
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.expandedRead).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  },
);

it("preserves historical capture after a later refund without asserting access or refund authority", async () => {
  requireCapturedReceiptAction();
  const f = await capturedReceiptFixture();
  const input = capturedSession();
  f.state.response = {
    ...input,
    payment_intent: {
      ...input.payment_intent,
      latest_charge: {
        ...input.payment_intent.latest_charge,
        refunded: true,
        amount_refunded: 3500,
      },
    },
  };
  const result = await f.caller.action(capturedRead, {
    stripeSessionId: f.sessionId,
  });
  expect(result).toMatchObject({ status: "ready", amount: 3500 });
  for (const field of ["accessGranted", "fulfilled", "refundable", "settled"])
    expect(result).not.toHaveProperty(field);
  expect(f.transport).toHaveBeenCalledTimes(1);
  expect(f.write).not.toHaveBeenCalled();
});

it.each([
  "pending",
  "unexpanded",
  "partial",
  "foreign-provider-account",
] as const)(
  "returns an unavailable observation for %s evidence without writing state",
  async (kind) => {
    requireCapturedReceiptAction();
    const f = await capturedReceiptFixture();
    const input = capturedSession();
    if (kind === "pending") {
      input.status = "open";
      input.payment_status = "unpaid";
    } else if (kind === "partial")
      input.payment_intent.latest_charge.amount_captured = 1000;
    else if (kind === "foreign-provider-account")
      input.payment_intent.customer_account = "acct_foreign";
    f.state.response =
      kind === "unexpanded"
        ? { ...input, payment_intent: "pi_captured_original" }
        : input;
    const before = await f.snapshot();
    const result = await f.caller.action(capturedRead, {
      stripeSessionId: f.sessionId,
    });
    expect(result).toMatchObject({ status: "unavailable" });
    expect(result).not.toHaveProperty("amount");
    expect(JSON.stringify(result)).not.toContain("private_");
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.write).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  },
);

it("rejects a live-mode provider configuration before transport", async () => {
  requireCapturedReceiptAction();
  const f = await capturedReceiptFixture();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not_a_real_key");
  await expect(
    f.caller.action(capturedRead, { stripeSessionId: f.sessionId }),
  ).rejects.toThrow();
  expect(f.transport).not.toHaveBeenCalled();
  expect(f.expandedRead).not.toHaveBeenCalled();
});

it("keeps provider failure unavailable and never returns its raw error", async () => {
  requireCapturedReceiptAction();
  const f = await capturedReceiptFixture();
  f.state.shouldFail = true;
  const result = await f.caller.action(capturedRead, {
    stripeSessionId: f.sessionId,
  });
  expect(result).toMatchObject({ status: "unavailable" });
  expect(JSON.stringify(result)).not.toContain("private_provider_error");
  expect(f.write).not.toHaveBeenCalled();
});
