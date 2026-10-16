import Stripe from "stripe";
import { env } from "../_generated/server";
export function getStripeClient() {
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2026-09-30.endive" });
}
