# Configure native usage billing in React

`UsageConfiguration`, `useUsageConfiguration` and `UsagePriceRow` are reusable,
unstyled package UI. Both component-backed Convex actions and authenticated HTTP
adapters use the same contract. No Metronome account or credentials are required.
Read [native catalog provisioning](usage-catalog.md), [usage views](usage-react.md)
and [authorization boundaries](usage-security.md) before wiring the adapter.

```tsx
import {
  UsageConfiguration,
  type UsageConfigurationValue,
} from "@fantastic.dev/better-stripe/react";

const initial: UsageConfigurationValue = {
  plan: {
    key: "api-calls",
    version: "v1",
    model: "pay_as_you_go",
    unit: { name: "call", precision: 0 },
    rate: { currency: "usd", unitAmountDecimal: "2" },
  },
  eventName: "api_calls_v1",
  displayName: "API calls",
};

<UsageConfiguration
  scope={authorizedConfigurationScope}
  initial={initial}
  meters={authorizedManagedMeters}
  onSave={saveAuthorizedConfiguration}
/>;
```

`scope` contains opaque `identityKey`, `accountKey` and `productKey`, a display
`ownershipLabel`, `role: "admin" | "seller"`, `canConfigure` and
`capability: "issuer_native" | "unsupported"`. Derive these on the host from the
signed-in actor and verified issuer account. They control browser state and
presentation. They do not authorize a server operation. Include actor changes in
`identityKey`, even if two actors share an account.

The form has no owner selector, provider secret input or browser Stripe callback.
The native APIs currently operate in the configured key's issuer realm, without
connected-account headers. Seller adapters must authorize the seller's product
within that supported realm; a role label does not enable arbitrary Connect
billing. A host must return unsupported for an ineligible provider/account setup.
These are BetterStripe components, not Stripe embedded catalog components.

## Supported settings

The billing model selects the relevant fields:

- **Pay as you go:** exact price per whole unit, currency, billable unit and
  quantity precision from 0 through 6.
- **Included monthly units plus overages:** the same rate as an overage rate,
  positive included units, and a reset at the original monthly billing period.
  Native pricing uses a graduated free first tier followed by an infinite paid
  tier. This does not add a monthly subscription fee or authorize work.
- **Prepaid paid credits:** a paid credit package quantity, manual top-up and
  reject-on-insufficient-credit policy. The package must have positive whole minor currency backing within the native
  payment bound and supported charge increments. Each later reservation must
  also have exact whole-minor backing. Fractional rates are supported when work
  uses suitable batches; fractional-minor consumption is rejected without rounding. Original terms
  remain attached to credits. Automatic top-up and a monetary wallet are not
  supported. Credit purchases fund only the issuer's own services.

Rates shown in the form are **major currency units per whole billable unit**.
The submitted `plan.rate.unitAmountDecimal` is an exact string in **minor currency
units per whole billable unit**. For example, `0.00125 USD` becomes `"0.125"` minor
units. Precision 2 gives Stripe a scaled-unit rate of `"0.00125"` minor units.
The form uses the existing plan, quantity, native rate and credit cost validators.
It rejects excessive precision and bounds rather than rounding. Provider account,
minimum payment, currency and payment-method eligibility still require server
validation and native observations.

Monthly interval and sum aggregation are the current supported configuration.
Other intervals, count/last aggregation, general tiers and transformed quantities
need an explicit supported server adapter. The form does not imply support by
accepting those settings.

## Immutable meter selection and versions

`meters` is an authorized subset/page of managed meters. Each entry contains `id`,
`active` and its original `configuration`. Do not pass arbitrary native meters
without first verifying/adopting them through the package. Do not describe a
partial page as complete inventory. Hosts can page or search their managed catalog
and replace the supplied subset.

Selecting an active meter loads its immutable original terms and disables edits.
Inactive meters cannot be selected. Choose **Create new meter version** to edit
new terms. The server must require a new plan version, event name and price lookup
key for changed terms. Saving does not migrate, cancel or reprice existing
subscriptions. Those keep their original price until an explicit authorized host
operation changes them.

Server adapters can import the `UsageConfigurationValue` type from
`@fantastic.dev/better-stripe/usage` without loading React types. The React entry
point continues to re-export it for UI consumers.

`onSave` receives `{ plan, eventName, displayName, meterId?, creditPackage? }`.
For prepaid, `creditPackage` is `{ quantity, topUp: "manual" }`. It is configuration
only. Saving does not create a payment, grant credits or authorize consumption.
The host must:

1. Authenticate the actor and authorize admin/seller access to the product.
2. Resolve the Stripe realm, mode, product and permitted immutable plan identity
   on the server. Ignore client attempts to choose financial ownership.
3. Revalidate the plan and selected original meter. Call `ensureUsageMeter` or
   verify/adopt the selected meter, then `ensureUsagePrice` with a stable lookup
   key. Persist the validated package policy in the host's authorized product
   configuration, not a second usage ledger.
4. For later purchases, use the package's [credit workflow](usage-credits.md),
   deriving `ownership: "issuer"` and `rollover: "retain_original_terms"` on the
   server. Verify payment before granting spending capacity.
5. Return only sanitized results. An uncertain create outcome must be reconciled
   using the original keys. Do not invent new identities to retry.

The package catalog persists intents and verifies immutable provider terms. A
browser duplicate-submit lock is only a UI convenience. Host authorization and
package idempotency remain mandatory after reloads or across tabs.

## State, styling and recovery

Inputs and save controls disable during submission. Validation errors identify
unsupported values. Provider errors use a sanitized retry/reconciliation message;
raw provider messages are not shown by the default UI. A successful save shows a
version confirmation. Changing scope, authoritative initial terms or meter choices
resets edits and discards delayed results. A read-only or unsupported host cannot
submit through the hook either.

Use `className`, `[data-better-stripe="usage-configuration"]`, ordinary semantic
HTML and associated labels to style the default form. A `children(state)` render
prop, or `useUsageConfiguration(props)`, exposes `fields`, `setField`, `meterId`,
`selectMeter`, `immutable`, `disabled`, `isPending`, `save`, `error` and `message`.
Keep immutable/disabled controls and error/status announcements accessible when
customizing. The hook retains the same validation and submission lifecycle.

`UsagePriceRow` accepts a discriminated `value`:

- `{ kind: "fixed", price }` reuses `PriceCard` formatting. Pass observed usage,
  billing-scheme and transformation metadata when available. Metered, tiered,
  transformed, missing amounts or unsupported charge units cannot masquerade as
  fixed zero prices.
- `{ kind: "metered", price }` uses the managed `UsagePriceBinding` returned by
  `getUsagePrice`. It displays the original plan version, exact whole-unit rate,
  model, monthly interval, aggregation, precision and active state. Included
  tiers and prepaid credit backing have separate explanations.
- `{ kind: "unsupported", reason: "tiered" | "transformed" | "other" }` labels
  other observed terms explicitly. It never infers a free price from a null
  amount.

Use `productName`, `className` or `children(value)` for the catalog row. It is
read-only. The form, catalog row and usage views share package contracts; the
example should compose them rather than implementing another pricing engine.
