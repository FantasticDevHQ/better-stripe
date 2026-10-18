import Stripe from "stripe";
import { withMeteringDiagnostics } from "./diagnostics";
import {
  usageDeliveryArgs,
  usageDeliveryResult,
} from "@fantastic.dev/better-stripe/usage";
import { internalAction, env } from "../_generated/server";
import { assertTestModeStripeKey } from "../users/authorization";
import { stripe } from "../stripe/helpers";
export const deliver = internalAction({
  args: usageDeliveryArgs,
  returns: usageDeliveryResult,
  handler: async (ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    return stripe.usage.deliver(ctx, args, {
      stripeSecretKey: env.STRIPE_SECRET_KEY,
      httpClient: withMeteringDiagnostics(
        Stripe.createFetchHttpClient(),
        (event) => console.warn("Native metering failure", event),
      ),
    });
  },
});
