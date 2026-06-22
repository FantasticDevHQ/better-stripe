import { defineComponent } from "convex/server";
import { v } from "convex/values";

const component = defineComponent("betterStripe", {
  env: {
    // The only env var the component itself reads (core/queries.ts: getStripeMode).
    // Declared as required so Convex validates its presence at push time; the
    // installing app wires it in via
    // `app.use(betterStripe, { env: { STRIPE_SECRET_KEY: app.env.STRIPE_SECRET_KEY } })`.
    //
    // Webhook secrets (STRIPE_WEBHOOK_SECRET / _V2) are intentionally NOT declared
    // here: they are read by the app layer (registerRoutes) directly from the
    // deployment env, never by the component.
    STRIPE_SECRET_KEY: v.string(),
  },
});
export default component;
