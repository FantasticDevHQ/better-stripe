import {
  BetterStripe,
  STRIPE_CUSTOMER_PREVIEW_API_VERSION,
} from "@fantastic.dev/better-stripe";
import { components } from "../_generated/api";
import { env } from "../_generated/server";

/** Explicit opt-in only for balance funding. The rest of the example stays GA. */
export const balanceStripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
  stripeApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
});
