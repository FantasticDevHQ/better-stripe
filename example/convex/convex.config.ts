import betterStripe from "@fantastic.dev/better-stripe/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

// betterStripe declares STRIPE_SECRET_KEY as a required env var, so the
// installing app must provide it. We declare it at the app level (its value
// comes from the deployment's `convex env set STRIPE_SECRET_KEY`) and pass it
// to the component by reference so the component always sees the current value.
const app = defineApp({
  env: {
    STRIPE_SECRET_KEY: v.string(),
  },
});
app.use(betterStripe, {
  env: { STRIPE_SECRET_KEY: app.env.STRIPE_SECRET_KEY },
});
export default app;
