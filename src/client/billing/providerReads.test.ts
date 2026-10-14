import type Stripe from "stripe";
import { expect, it, vi } from "vitest";
import {
  getCheckoutSessionFromStripe,
  getSubscriptionFromStripe,
  getCouponFromStripe,
} from "./providerReads.js";
it("retrieves authoritative expanded provider objects without consulting the component cache", async () => {
  const raw = {
    checkout: {
      sessions: {
        retrieve: vi
          .fn()
          .mockResolvedValue({ id: "cs_1", payment_status: "paid" }),
      },
    },
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({ id: "sub_1", status: "active" }),
    },
    coupons: {
      retrieve: vi.fn().mockResolvedValue({ id: "coupon_1", valid: true }),
    },
  };
  const stripe = raw as unknown as Stripe;
  expect(
    await getCheckoutSessionFromStripe(stripe, {
      stripeSessionId: "cs_1",
      expand: ["subscription", "payment_intent"],
    }),
  ).toMatchObject({ payment_status: "paid" });
  expect(raw.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_1", {
    expand: ["subscription", "payment_intent"],
  });
  await getSubscriptionFromStripe(stripe, {
    stripeSubscriptionId: "sub_1",
    expand: ["latest_invoice"],
  });
  expect(raw.subscriptions.retrieve).toHaveBeenCalledWith("sub_1", {
    expand: ["latest_invoice"],
  });
  await getCouponFromStripe(stripe, { stripeCouponId: "coupon_1" });
  expect(raw.coupons.retrieve).toHaveBeenCalledWith("coupon_1", {
    expand: undefined,
  });
});

it("preserves Stripe error identity and codes for server reconciliation", async () => {
  const failure = Object.assign(new Error("No such Checkout Session"), {
    code: "resource_missing",
    statusCode: 404,
  });
  const raw = {
    checkout: { sessions: { retrieve: vi.fn().mockRejectedValue(failure) } },
  };
  await expect(
    getCheckoutSessionFromStripe(raw as unknown as Stripe, {
      stripeSessionId: "cs_missing",
    }),
  ).rejects.toBe(failure);
});
