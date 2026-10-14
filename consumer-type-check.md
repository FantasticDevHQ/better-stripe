# Packed-candidate consumer type check

Command: `tsc --ignoreConfig --noEmit --skipLibCheck --module NodeNext --target ES2022 contracts.ts`.
Result: exit 0. The temporary consumer installed the enclosed candidate tarball, not source aliases or the registry 0.10.0 package.

```ts
import { BetterStripe, STRIPE_CUSTOMER_PREVIEW_API_VERSION, type SupportedStripeApiVersion } from "@fantastic.dev/better-stripe";
import type { HttpRouter } from "convex/server";
declare const component: ConstructorParameters<typeof BetterStripe>[0];
declare const http: HttpRouter;
const stripe = new BetterStripe(component, { STRIPE_SECRET_KEY: "sk_test_contract_fixture", stripeApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION });
const version: SupportedStripeApiVersion = stripe.stripeApiVersion;
stripe.registerRoutes(http, { webhookSecret: "whsec_fixture", webhookSecretV2: "whsec_fixture_v2" });
// @ts-expect-error Unsupported client API versions are rejected by the public type.
const invalid: SupportedStripeApiVersion = "2020-08-27";
void [version, invalid];

```
