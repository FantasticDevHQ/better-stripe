import {
  BetterStripe,
  STRIPE_CUSTOMER_PREVIEW_API_VERSION,
} from "@fantastic.dev/better-stripe";
import { env } from "../_generated/server";
import { components } from "../_generated/api";

/** Explicit opt-in only for balance funding. The rest of the example stays GA. */
export const balanceStripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
  stripeApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
});
