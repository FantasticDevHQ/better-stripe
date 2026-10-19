# Provision the native usage catalog

BetterStripe uses Stripe Billing Meters and recurring metered Prices. No
Metronome account is required. Follow [sandbox setup](metering-setup.md) first.
These methods run in authenticated host actions. Resolve the account, test/live
mode, plan and product on the server, and authorize the caller before provisioning.

```ts
import { defineUsagePlan } from "@fantastic.dev/better-stripe/usage";

const plan = defineUsagePlan({
  key: "api-calls",
  version: "v1",
  model: "pay_as_you_go",
  unit: { name: "call", precision: 0 },
  rate: { currency: "usd", unitAmountDecimal: "2" },
});
const scope = { stripeAccountId: verifiedPlatformAccountId, livemode: false };
const meter = await stripe.ensureUsageMeter(ctx, {
  scope,
  plan,
  eventName: "api_calls_v1",
  displayName: "API calls v1",
});
const price = await stripe.ensureUsagePrice(ctx, {
  scope,
  plan,
  meterId: meter.id,
  stripeProductId: verifiedProductId,
  lookupKey: "api_calls_v1_usd",
});
// price is a Convex-safe UsagePriceBinding with exact string amounts.
```

Use `model: "included_overage"`, `includedQuantity: "1000"` and
`reset: "billing_period"` for monthly included units with overages. Stripe receives
a graduated free first tier and an infinite paid tier. Use `model: "prepaid"` and
`insufficientBalance: "reject"` for the prepaid catalog. Its recurring price charges
the configured rate, and payment-backed Billing Credit Grants offset eligible
charges. Provisioning this price does not fund credits or enforce a balance.
Use the [model recipes](metered-usage.md) and [opt-in rollout](usage-rollout.md) before enabling consumption.

Rates are decimal minor currency units per whole billable unit. With precision 2,
a rate of `"2"` becomes `"0.02"` per scaled provider unit. The adapter rejects more
than 12 provider decimal places rather than rounding. Included tier boundaries
must be exact positive safe integers after scaling. Monthly intervals, sum
aggregation, `stripe_customer_id` and `value` mappings are supported. Other
intervals, transformations and provider terms require an explicit adapter change.

The configured Stripe key must own `scope.stripeAccountId`. The adapter verifies
that account and the key's mode before writes. Connected-account headers are not
supported by these APIs. Restricted keys that cannot perform this verification
return `provider_unavailable`. A mismatch returns `unsupported_scope`.

## Immutable identities and recovery

A meter identity is scoped by account, mode, plan key and version. A price identity
uses the same account/mode plus its lookup key. Plan terms, event name, mappings,
product, price currency and rates cannot change under those identities. Use a new
version, event name and lookup key for changed terms. A provider resource cannot
be adopted into a second managed identity.

The component persists a creation intent before calling Stripe and uses a stable
idempotency key. Retries verify provider terms and repair a failed mirror write.
Pinned resources are retrieved by ID and never recreated when retrieval fails.
Unpinned meter discovery is bounded to 1,000 resources. Incomplete discovery,
ambiguous matches and conflicting terms stop provisioning.

Automatic creation stops 23 hours after the first intent. Stripe's idempotency
retention is finite. An absent result after that point returns
`unknown_create_outcome`; investigate the provider account and adopt the verified
existing meter rather than generating another event identity. Found matching
resources can still repair a mirror after this window. Do not delete intent rows
or change keys to retry an uncertain write.

## Lifecycle and reads

`adoptUsageMeter` accepts an exact provider meter ID plus the same configuration
as `ensureUsageMeter`. `getUsageMeterFromStripe` retrieves one ID.
`listStripeUsageMeters` accepts a page limit of 1–100 and optional cursor, and
returns `data`, `hasMore` and `cursor`. These provider methods require the same
verified scope. `deactivateUsageMeter` and `reactivateUsageMeter` operate only on
managed IDs and refresh their local observation.

Deactivation stops new usage ingestion for that meter. It does not migrate or
cancel existing subscriptions, settle prior usage or change immutable prices.
Review active subscriptions and queued delivery before deactivation. Explicitly
create and bind a new version when changing billing terms.

`getUsagePrice(ctx, { scope, lookupKey })` is a local query-compatible reader.
Its `available` result contains `observedAt` and a discriminated
`pricingMode: "metered"` binding, exact string amounts and explicit tiers. Missing,
pending and invalid observations return typed `unavailable` states. Reauthorize
every read. Cached observations do not prove fresh provider state or invoicing.

The legacy fixed-price mirror and its readers only represent fixed integer prices.
Webhook and bulk sync omit metered, tiered, transformed and decimal-only prices
instead of converting a null amount into zero. Use the scoped usage reader for
managed metered prices. Historical mirrors written by earlier package versions
are not automatically migrated; audit those records before relying on old data.
Existing fixed-price creation, adoption and readers retain their contracts.

Authoritative references: [Stripe meters](https://docs.stripe.com/api/billing/meter),
[usage-based prices](https://docs.stripe.com/billing/subscriptions/usage-based/implementation-guide),
[idempotency retention](https://docs.stripe.com/api/idempotent_requests), and
[Billing Credit Grant eligibility](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits).
