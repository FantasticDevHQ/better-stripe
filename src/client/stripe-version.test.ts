import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { getStripe } from "../component/lib/stripeFactory.js";
import { STRIPE_API_VERSION } from "./constants.js";
import { getStripeClient } from "./helpers.js";

describe("Stripe version pin", () => {
  it("matches the supported stripe-node API, including the full endive suffix", () => {
    expect(STRIPE_API_VERSION).toBe("2026-09-30.endive");
    expect(Stripe.API_VERSION).toBe(STRIPE_API_VERSION);
  });

  it.each([getStripeClient, getStripe])(
    "pins outgoing API requests from each factory",
    async (factory) => {
      const stripe = factory("sk_test_version_transport_only");
      let version: string | undefined;
      // Factories deliberately expose no transport override. Replace only the
      // SDK's transport slot, leaving its request serializer/headers untouched.
      const transportSlot = stripe as unknown as {
        _setApiField: (field: string, value: unknown) => void;
      };
      transportSlot._setApiField("httpClient", {
        getClientName: () => "test",
        makeRequest: async (
          ...[, , , , headers]: Parameters<
            ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
          >
        ) => {
          version = String(headers["Stripe-Version"]);
          return {
            getStatusCode: () => 200,
            getHeaders: () => ({}),
            getRawResponse: () => ({}),
            toJSON: async () => ({ id: "prod_local", object: "product" }),
            toStream: () => {
              throw new Error("Unexpected stream");
            },
          };
        },
      });
      await stripe.products.retrieve("prod_local");
      expect(version).toBe(STRIPE_API_VERSION);
    },
  );
});
