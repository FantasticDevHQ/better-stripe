import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { createCheckoutSession } from "./checkout.js";
for (const [mode, expected] of [
  ["custom", "elements"],
  ["form", "form"],
] as const)
  it(`creates ${mode} checkout without hosted URLs`, async () => {
    const create = vi.fn().mockResolvedValue({
      id: "cs_test",
      status: "open",
      mode: "payment",
      client_secret: "client_secret_test",
      metadata: {},
      expires_at: 1800000000,
    });
    const component = {
      billing: {
        mutations: {
          upsertCheckoutSession: {
            [Symbol.for("toReferencePath")]:
              "betterStripe/billing/mutations/upsertCheckoutSession",
          },
        },
      },
    } as unknown as Component;
    await createCheckoutSession(
      { checkout: { sessions: { create } } } as unknown as Stripe,
      component,
      {
        runQuery: vi.fn().mockResolvedValue(null),
        runMutation: vi.fn(),
      } as unknown as RunCtx,
      {
        userId: "user_1",
        stripePriceId: "price_1",
        mode: "payment",
        uiMode: mode,
        returnUrl: "https://app.test/return",
      },
    );
    expect(create.mock.calls[0][0]).toMatchObject({
      ui_mode: expected,
      return_url: "https://app.test/return",
    });
    expect(create.mock.calls[0][0].success_url).toBeUndefined();
    expect(create.mock.calls[0][0].cancel_url).toBeUndefined();
  });
