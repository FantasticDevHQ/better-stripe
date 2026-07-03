---
"@getdojo/better-stripe": minor
---

Add embedded Stripe Connect dispute components (BTS-55, #48).

The Stripe-hosted alternative to the headless dispute components, built on `@stripe/react-connect-js`:

- `ConnectProvider` — initializes ConnectJS once per mount via `loadConnectAndInitialize({ publishableKey, fetchClientSecret, appearance?, locale? })` and provides the instance through `ConnectComponentsProvider`. `fetchClientSecret` wires to an app action wrapping `stripe.createDisputeSession({ stripeAccountId })` (BTS-30).
- `EmbeddedDisputes` — mounts Stripe's `disputes_list` embedded component, or `payment_disputes` scoped to one payment via the `payment` prop. Must render inside `ConnectProvider`.

Adds `@stripe/connect-js` and `@stripe/react-connect-js` as regular dependencies, mirroring the existing `@stripe/stripe-js`/`@stripe/react-stripe-js` convention. Purely additive.
