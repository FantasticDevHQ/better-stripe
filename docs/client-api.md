# Server API

## Client API reference

All methods are available on the `BetterStripe` class instance. Methods that call the Stripe API are actions; methods that only read Convex data are queries.

Methods named `get<Entity>` take the component document ID (exception: `getInvoice`, which takes the Stripe invoice ID); methods named `get<Entity>ByStripeId` take the Stripe ID (`acct_...`, `prod_...`, `price_...`, `cs_...`, `sub_...`).

### Account

`closeAccount` and its `restartAccountOnboarding` alias retain a durable closure
record before contacting Stripe. Successful closure removes the active account
mapping but preserves the original user/organization ownership, close timestamp
and financial rows. A pending attempt pins its owner through retry; delayed
account upserts cannot revive a closed recipient. Retrying after provider success
and local persistence failure retrieves provider state and completes locally
without closing an already closed account again. A required provider lookup that
fails now stops closure rather than submitting an empty configuration guess.

`getClosedAccountByStripeId(ctx, { stripeAccountId })` retrieves closed provenance;
`listClosedAccountsByUserId(ctx, { userId, paginationOpts })` discovers personal
closed accounts using indexed pages of 1–100 records. Organization accounts are
excluded from personal discovery. These are trusted host APIs: authenticate the
actor and check both original user and organization scope before passing the
historical Stripe account ID to existing payout, transfer or commission readers.
A supplied userId or a replacement account never proves historical ownership.
An untracked legacy closure has no invented owner and is not discoverable as a
personal account. Records deleted before this contract cannot be reconstructed.

Closure provenance does not evaluate outstanding funds, reservations, recovery
liabilities or permission to create a replacement. Applications must enforce
those policies before exposing `AccountCloseCard`; its render props provide
presentation and confirmation, not financial authorization. Do not use closure
as an automatic delete-and-recreate onboarding reset. Existing active-account
getters keep their signatures and exclude completed closures; historical readers
retain original financial references. The Vite reference's
[closed-account authorization example](https://github.com/FantasticDevHQ/better-stripe/blob/main/example/README.md#closed-account-history)
shows where the host's authenticated-actor check belongs.

| Method                                                                            | Description                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `createAccount(ctx, { userId, email?, name?, country?, orgId?, metadata? })`      | Create a V2 account in Stripe and the component database                     |
| `getAccount(ctx, { accountId })`                                                  | Get account by component document ID                                         |
| `getAccountByStripeId(ctx, { stripeAccountId })`                                  | Get account by Stripe account ID                                             |
| `getOrCreateAccount(ctx, { userId, email?, name?, country?, orgId?, metadata? })` | Get existing or create new account                                           |
| `getAccountByUserId(ctx, { userId })`                                             | Get account by app-layer user ID                                             |
| `getAccountByOrgId(ctx, { orgId })`                                               | Get account by organization/team ID                                          |
| `getAccountOnboardingStatus(ctx, { accountId })`                                  | Get Connect onboarding status (by component document ID)                     |
| `updateAccount(ctx, { stripeAccountId, email?, name?, metadata? })`               | Update account fields                                                        |
| `createAccountLink(ctx, { stripeAccountId, refreshUrl, returnUrl, type })`        | Create Connect onboarding or update link                                     |
| `createAccountSession(ctx, { stripeAccountId, components })`                      | Create embedded account management session                                   |
| `createLoginLink(ctx, { stripeAccountId })`                                       | Create Express dashboard login link                                          |
| `addRecipientConfiguration(ctx, { stripeAccountId })`                             | Add recipient configuration to an existing account                           |
| `getV2Account(ctx, { stripeAccountId, include? })`                                | Retrieve a V2 account directly from Stripe                                   |
| `updateV2Account(ctx, { stripeAccountId, updateParams })`                         | Update a V2 account in Stripe                                                |
| `listStripeAccounts(ctx, { limit? })`                                             | List V2 accounts directly from Stripe                                        |
| `closeAccount(ctx, { stripeAccountId })`                                          | Close a V2 account; returns `{ closed: boolean }`                            |
| `restartAccountOnboarding(ctx, { stripeAccountId })`                              | Close the account so onboarding can restart fresh                            |
| `setAccountStatementDescriptor(ctx, { stripeAccountId, statementDescriptor })`    | Set (or `null` to clear) the account's per-store statement-descriptor suffix |
| `createDisputeSession(ctx, { stripeAccountId })`                                  | Create an embedded Account Session scoped to the seller's disputes           |

### Product and Price

`ensurePrice(ctx, { stripeProductId, lookupKey, unitAmount, type, idempotencyKey, currency?, interval?, intervalCount? })` finds a price by its provider lookup key, verifies its immutable terms, and adopts the price and product into the component mirrors. If absent, it creates the price with the supplied idempotency key. A matching provider result repairs a failed mirror write on retry. Inactive prices, different products or pricing terms, and metered or transformed pricing are rejected. Choose a new versioned lookup key when changing price terms; existing subscriptions retain their current price.

Scope the idempotency key to one catalog operation and reuse it only with identical creation parameters. Authorize product access in your host action. `getStripePriceByLookupKey(ctx, { lookupKey })` reads Stripe without changing mirrors. `adoptProduct(ctx, { stripeProductId, accountId? })` imports an existing provider product, preserving existing ownership and rejecting reassignment. Adoption does not update provider metadata or statement descriptors. `createPrice` also accepts `lookupKey` for callers handling adoption themselves. Tier names, lookup-key version policy, and entitlement mapping remain in the host app.

| Method                                                                                                                | Description                                 |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `createProduct(ctx, { name, description?, active?, accountId?, metadata?, statementDescriptor?, idempotencyKey? })`   | Create product in Stripe and component DB   |
| `getProduct(ctx, { productId })`                                                                                      | Get product by component document ID        |
| `getProductByStripeId(ctx, { stripeProductId })`                                                                      | Get product by Stripe product ID            |
| `listProducts(ctx, { accountId?, active?, limit? })`                                                                  | List products with optional filters         |
| `updateProduct(ctx, { stripeProductId, idempotencyKey?, ...updates })`                                                | Update product fields                       |
| `deactivateProduct(ctx, { stripeProductId, idempotencyKey? })`                                                        | Deactivate product at Stripe                |
| `createPrice(ctx, { stripeProductId, unitAmount, type, currency?, interval?, intervalCount?, nickname?, metadata? })` | Create price in Stripe and component DB     |
| `getPrice(ctx, { priceId })`                                                                                          | Get price by component document ID          |
| `getPriceByStripeId(ctx, { stripePriceId })`                                                                          | Get price by Stripe price ID                |
| `listPrices(ctx, { productId?, active?, limit? })`                                                                    | List prices with optional filters           |
| `updatePrice(ctx, { stripePriceId, ...updates })`                                                                     | Update price fields                         |
| `deactivatePrice(ctx, { stripePriceId })`                                                                             | Deactivate price in Stripe and component DB |

### Product statement descriptors

`createProduct` and `updateProduct` accept `statementDescriptor?: string | null`,
including for platform-owned products without an `accountId`.

| Input                  | Create                                                                           | Update                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Explicit string        | Trim, validate and send `statement_descriptor`                                   | Trim, validate and send `statement_descriptor`                                          |
| Omitted or `undefined` | Keep legacy store/default resolution; a storeless product receives no descriptor | Keep legacy store/default refresh behavior                                              |
| `null`                 | Suppress inheritance and omit the provider field                                 | Send an empty provider field to clear it, without account/default fallback in this call |

Invalid explicit values reject before provider HTTP. An invalid inherited
store/default value retains the legacy logged-skip behavior. Null is an input
for this operation, not a persisted override: a later omitted-option update of
an account-associated product can restore its legacy account/default descriptor.
Use the same explicit input and stable `idempotencyKey` for an identical retry.
The SDK forwards provider errors and does not invent a new key or retry command.

```ts
await stripe.createProduct(ctx, {
  name: "Community membership",
  statementDescriptor: "COMMUNITY ONE",
  idempotencyKey: "catalog:create:original",
});
await stripe.updateProduct(ctx, {
  stripeProductId: originalProductId,
  statementDescriptor: null,
  idempotencyKey: "catalog:descriptor-clear:original",
});
```

The matching Vite `example/convex/products/actions.ts` forwards the same optional
inputs. Its demo actions do not supply host authorization. A host must authorize
the operator, bind its community to the exact original product and reject shared
products that would need different descriptors. This API does not change payout
accounts, merchant routing or the host's saved community policy. Product updates
do not synchronously refresh the component mirror; retain the existing signed
mirror/read reconciliation contract.

[Stripe's subscription precedence](https://docs.stripe.com/connect/statement-descriptors#subscriptions-and-invoices)
is invoice, product, then the charge-type default. Product configuration can
cover the first automatic subscription invoice before an invoice webhook runs.
It does not configure a one-time card PaymentIntent suffix. The existing invoice
processor's timing and logged-failure limits remain unchanged. Respect the
[descriptor format and combined-length rules](https://docs.stripe.com/get-started/account/statement-descriptors)
and actual platform prefix. Issuers can render descriptors differently; synthetic
transport tests are not live first-invoice, renewal or bank-statement evidence.
Public release, artifact verification and accepted host adoption precede use of
this new option by a downstream app.

### Checkout and Subscription

| Method                                                                                                                                                                                                                   | Description                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `createCheckoutSession(ctx, { userId, stripePriceId, mode, returnUrl, uiMode?, quantity?, trialDays?, accountId?, orgId?, customerEmail?, destinationAccountId?, split?, fee?, amount?, metadata?, sessionOverrides? })` | Create checkout session (embedded or redirect); `destinationAccountId`/`split` route funds, `fee` overrides the platform's configured default |
| `getCheckoutSession(ctx, { sessionId })`                                                                                                                                                                                 | Get checkout session by component document ID                                                                                                 |
| `getCheckoutSessionByStripeId(ctx, { stripeSessionId })`                                                                                                                                                                 | Get checkout session by Stripe session ID                                                                                                     |
| `createSubscription(ctx, { userId, orgId?, customerAccount, stripePriceId, destinationAccountId?, split?, fee?, trialDays?, metadata? })`                                                                                | Create a subscription directly for a V2 buyer (off the checkout flow), with the same routing/fee options as checkout                          |
| `getSubscription(ctx, { subscriptionId })`                                                                                                                                                                               | Get subscription by component document ID                                                                                                     |
| `getSubscriptionByStripeId(ctx, { stripeSubscriptionId })`                                                                                                                                                               | Get subscription by Stripe subscription ID                                                                                                    |
| `listSubscriptions(ctx, { stripeAccountId?, status?, limit? })`                                                                                                                                                          | List subscriptions, optionally scoped to a Connect account (use `listSubscriptionsByUser` for per-user filtering)                             |
| `listSubscriptionsByUser(ctx, { userId, status? })`                                                                                                                                                                      | List all subscriptions for a user                                                                                                             |
| `listSubscriptionsByOrg(ctx, { orgId, status? })`                                                                                                                                                                        | List all subscriptions for an organization                                                                                                    |
| `getActiveSubscription(ctx, { userId, orgId? })`                                                                                                                                                                         | Get the active subscription for a user or org                                                                                                 |
| `getTrialStatus(ctx, { subscriptionId })`                                                                                                                                                                                | Get trial state for a subscription                                                                                                            |
| `cancelSubscription(ctx, { stripeSubscriptionId, cancelAtPeriodEnd? })`                                                                                                                                                  | Cancel subscription immediately or at period end                                                                                              |
| `reactivateSubscription(ctx, { stripeSubscriptionId })`                                                                                                                                                                  | Clear scheduled end-of-period cancellation before the subscription terminates                                                                 |
| `updateSubscriptionQuantity(ctx, { stripeSubscriptionId, quantity })`                                                                                                                                                    | Update subscription seat quantity                                                                                                             |

### Durable recovery claims

`stripe.costRecovery` is a server-only recovery client backed by the Convex
component. Bookkeeping methods do not use Stripe credentials or move money.
Invoice methods use the configured Stripe client and must run in an action.
Your host authenticates the
caller, approves which costs are owed, authorizes the account and recovery scope,
and verifies provider outcomes before confirming collection. A recovery scope is
an application-defined liability boundary, such as one store. Amounts are signed
integer minor units and currencies never mix.

```ts
const recovery = stripe.costRecovery;
const scope = {
  accountId: sellerAccountId,
  scopeKey: storeId,
  currency: "usd",
};
await recovery.recordClaim(ctx, {
  ...scope,
  claimKey: `cost:${chargeId}`,
  sourceChargeId: chargeId,
  sourceGross: originalGross,
  sourceProcessingFee: originalProviderFee,
  amountDue: approvedCumulativeCost,
  revision: durableObservationRevision,
});
const result = await recovery.reserve(ctx, {
  ...scope,
  groupKey: `settlement:${fundingChargeId}`,
  operationKey: `settlement:${fundingChargeId}:batch:1`,
  sourceKind: "settlement",
  sourceId: fundingChargeId,
  sourceGross: fundingGross,
  sourceProcessingFee: fundingProviderFee,
  maxDebit: availableSellerEarnings,
  maxCredit: approvedCreditBudget,
});
```

Claims retain their original charge, account, scope, currency, gross and provider
fee. Replays of the same revision must have the same amount; lower revisions are
ignored. The host must assign durable, monotonically increasing observation
revisions from authoritative reconciliation, not an unordered event arrival
counter. Use `getClaim(ctx, { claimKey })` to capture the prior revision before
reading provider state, then propose the next revision. On a conflicting revision,
retry the full provider reconciliation, rather than incrementing the revision of
an already-stale snapshot. Later provider observations update cumulative `amountDue`, including
signed credits, without erasing collected or reserved history. Claim keys beginning
with `rollback:` are reserved by the package.

Reservations use maintained totals across all claims, so a credit beyond the
first history page still reduces the recoverable amount. Each call allocates at
most 100 claims. Repeat with distinct, durable batch operation keys in the same
group until `seal(ctx, { groupKey })` succeeds. The group's debit/credit budgets
apply across all batches. A group identifies exactly one external money boundary;
only one group per account/scope/currency may remain pending. Retry the same batch
key to recover the same allocation after a timeout or host write failure.

Seal before any provider side effect. New claim observations can require another
batch before sealing; observations after sealing remain owed or credited for a
later group. After verifying the provider's final result, call
`finish(ctx, { groupKey, outcome: "collect" | "release" })`. Completion processes
at most ten reservations per call, each with at most 100 claims. Repeat while
`isDone` is false using separate action/job invocations when needed to respect
Convex transaction limits. Completion is idempotent; a collected group cannot be
released or reused with another outcome. Do not release an unknown provider
outcome just because a request timed out. An unpaid invoice must stay reserved
until its verified payment or cancellation policy resolves it.

For a collected settlement group whose funding sale is later returned, call
`rollback(ctx, { groupKey, returnedPrincipal, revision })` with the authorized
cumulative principal. This records a separate, source-linked rollback claim,
preserves the original costs and collection history, and rounds positive and
negative amounts symmetrically. Reinstated principal can reduce the rollback
again with a newer revision. This bookkeeping operation does not refund or
reverse a transfer. For invoice groups, use the verified funding adapter below;
do not invent invoice payment allocations.

Use `balance(ctx, scope)` for exact maintained totals and
`listClaims(ctx, { ...scope, limit, cursor })` for paginated history. `getClaim`, `getGroup` and
`getReservation` resume durable workflows. Integrate these server callbacks with
the existing unstyled React `CostRecovery` display. These bookkeeping APIs leave
consent, provider fee policy and entitlement changes in the host.

The example uses these package calls for sale reservations, verified collection,
monthly invoice adjustments and source observations. Its host stores source and
display metadata; financial totals come from the component. `CostRecovery` accepts
an optional `reservedAmount` to distinguish reservations from collected money,
while preserving the legacy `invoicedAmount` input. See the example README for
cutover constraints and the sandbox renewal acceptance procedure.

### Atomic recovery preparation

Call `stripe.costRecovery.prepareGroup(ctx, { ...groupOptions, limit: 100 })`
after authorizing the account, scope, currency, source and debit/credit policy.
Each call reserves at most one batch and seals the completed target in the same
component mutation. It returns `{ status: "prepared", group, isDone }`. Continue
with unchanged group options while `isDone` is false; do not run provider effects
until it is true. Sealed or finished replay returns the saved group without
another reservation. Batch identities use a persisted sequence, independent of
pending or completed reservation counts. The optional limit must be 1 through
100 and can change between bounded calls.

A competing boundary returns `{ status: "conflict", reason: "scope_busy",
retryable: false }`. Changed group identity or a legacy operation-key collision
returns `identity_changed`; invalid scope or policy returns `rejected`. These
outcomes do not reserve anything. Read current state and let host policy decide
what to do; conflicts are not automatic retries. Existing `reserve`, `seal` and
`finish` methods remain available. Host reporting and provider execution remain
separate from preparation.

### Importing opening recovery balances

When moving an existing ledger into the component, your server can call
`stripe.costRecovery.importClaim(ctx, { ...observation, operationKey, collectedAmount })`.
The observation includes the authorized account/scope/currency, original charge,
gross and processing fee, approved cumulative amount due and a durable revision.
`collectedAmount` is the signed amount already verified as collected before the
cutover. The component retains that opening snapshot and computes outstanding as
amount due minus the imported collection. It does not create a Stripe payment.

Quiesce the old ledger's writers and verify its invoice and payout outcomes first.
An unpaid invoice is a reservation, not a collection; an unknown provider outcome
must stay held until reconciled. Do not import those amounts as collected or
silently release them. Authorize source identity and original provider economics
in the host before invoking this server-only bookkeeping operation.

Use one stable import operation key per claim. A replay returns the current claim
even after later observations or collections, without resetting its opening
amount. Changing the opening snapshot or source binding, reusing an operation key
for another claim, importing over a normal live claim, or introducing a new
opening balance while the scope has a pending external recovery group is rejected.
Signed credit collections and currencies stay separate. New observations continue
through `recordClaim` with newer durable revisions.

### Invoice recovery adjustments

After authorizing the seller, invoice and liability scope, reserve with
`sourceKind: "invoice"` and `sourceId: invoiceId`. Allocate bounded batches and
seal the group before calling Stripe. Then attach exactly one signed adjustment
for the entire group:

```ts
const receipt = await recovery.attachInvoice(ctx, { ...scope, groupKey });
// Invoke from your invoice lifecycle reconciliation, and repeat bounded completion
// until isDone after payment or release.
const result = await recovery.reconcileInvoice(ctx, {
  ...scope,
  groupKey,
  releaseUncollectible: false,
});
```

The invoice must belong to the authorized customer account, use the same currency,
and be draft before a new item is created. The package stores its stable group
identity before the provider call, uses that identity as the idempotency key and
item metadata, and persists the resulting item ID. Every retry scans all items
on that exact invoice, recovering a successful creation even if the subsequent
database write failed or the provider idempotency key expired. A bound item that
has been deleted, changed or duplicated requires reconciliation; the package
never silently recreates it. Negative adjustments are credits. Items are not
discountable.

Your host must durably serialize provider operations for each group, including
attachment and any calls that finish or release it. Never release a reservation
after a timeout or unknown provider outcome. Draft and open invoices retain their
reservations, blocking recovery from a second payout. A verified paid invoice
commits collection; a verified void releases the obligation for a future boundary.
If an invoice is voided before its adjustment was attached, reconciliation releases
an unbound sealed group only after scanning every item on that exact invoice.
The receipt then has `invoiceItemId: null`. A missing previously bound item, or
an absent adjustment on a paid or unpaid invoice, remains an error and keeps
reservations held.
Uncollectible invoices stay reserved unless your explicit host policy passes
`releaseUncollectible: true`. Do not use that policy while another process might
retry payment on the original invoice. Subscription cancellation alone does not
prove its invoices were voided. These methods never attempt card fallback or
change a payout schedule.

For a collected invoice fully funded by one PaymentIntent, call
`rollbackInvoice(ctx, { ...scope, groupKey, revision })`. It checks the paid
invoice, completely paginates its payments, verifies the funding charge and its
refund/dispute transactions, retains the original funding economics, and records
a separate proportional rollback claim. Use a durable revision captured before
provider reconciliation, and retry the full read on revision conflicts. Original
cost claims remain intact. Multiple payments, partial allocations, mixed customer
credits and non-PaymentIntent funding return
`{ status: "not_ready", reason: "invoice_funding_allocation_required" }` without
changing claims. Provider processing costs can also return their documented
not-ready reasons. Those cases need a host-approved allocation policy rather than
guessed amounts. Invoice integration in the example is a separate migration.

Provider methods preserve the configured API version and propagate Stripe errors.
See Stripe's [invoice item creation](https://docs.stripe.com/api/invoiceitems/create)
and [invoice item pagination](https://docs.stripe.com/api/invoiceitems/list).

### Refund and dispute processing costs

`getProcessingCostContext(ctx, { paymentIntentId, stripeAccountId? })` reads
provider costs for an authorized payment, including refunded and disputed
charges. Authorize both the payment and optional connected-account namespace in
your host. The client preserves its configured API version and provider errors;
it does not settle a sale, move money, create debt or decide which costs a seller
owes. The example's cost adapter uses this method while keeping its billing policy
in the application.

A `ready` result contains every refund and dispute, source-linked balance
transactions, signed fee adjustments and provider amounts in integer minor units.
Dates are milliseconds. `processingFee` is the original charge balance
transaction's total provider-reported fee, which can include application fees on
direct charges. Each transaction exposes `feeDetails` so your approved policy can
distinguish processor, application and other fees. A null breakdown means provider
details were unavailable; the reported total remains authoritative. Negative fee
adjustments remain credits. Failed refunds include their failure reversal instead
of counting their principal as returned.

`principalReturned` caps the combined economic refund/dispute principal at the
original gross amount. Raw signed provider transactions remain intact, including
any overlapping debits, and are not a seller debt calculation. A won dispute with
an unreinstated principal withdrawal is `not_ready`. Pending refunds, missing cost
transactions or different settlement currencies also return an explicit
`not_ready` reason instead of estimated or mixed-currency totals. Provider
pagination errors throw rather than returning partial data. Retry delayed
provider data; resolve currency conversion through an explicit host policy.

See Stripe's [balance transaction fields](https://docs.stripe.com/api/balance_transactions/object)
and [refund failure reversals](https://docs.stripe.com/api/refunds/object).

### Optional balance-funded subscriptions

Balance funding requires an eligible connected account and Stripe's Accounts v2
balance-payment preview. It is separate from non-Connect customer-only Accounts
v2 eligibility. Keep your normal client on GA; construct a separate client with
`stripeApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION` for this optional feature.
`getBalanceFundingCapability()` reports whether that client is explicitly
configured. It does not claim the account has provider approval; Stripe validates
eligibility when preparing the payment method.

After authenticating the seller, authorizing the subscription, and recording
explicit recurring-debit consent in your own database:

```ts
const preparation = await balanceStripe.prepareBalanceFunding(ctx, {
  customerAccount: authorizedSellerAccountId,
  stripeSubscriptionId: authorizedSubscriptionId,
  consent: true,
  idempotencyKey: durablePreparationRequestId,
});
// Persist this immutable server-side record BEFORE enabling balance payments.
await savePreparationAndConsent(preparation);
await balanceStripe.setBalanceFunding(ctx, {
  preparation,
  enabled: true,
  consent: true,
  idempotencyKey: durableEnableRequestId,
});
// Opt-out restores the previous default method and payment-method types.
await balanceStripe.setBalanceFunding(ctx, {
  preparation: await loadPersistedPreparation(),
  enabled: false,
  idempotencyKey: durableDisableRequestId,
});
```

`prepareBalanceFunding` creates/attaches a `stripe_balance` method and captures
the prior subscription settings without changing them. `setBalanceFunding`
checks subscription ownership and payment-method ownership, then changes the
settings or recognizes that the requested state already exists. Null prior
settings restore inheritance from the customer's settings. External source
changes cause an error instead of being overwritten. Provider errors are
preserved. Never accept restoration records or account IDs from an unauthenticated
browser as authority.

The example now uses component-owned
[`balanceFundingWorkflow`](balance-funding-workflow.md) for preparation,
apply, receipts and reconciliation. Its host adapter keeps consent and request
references; it no longer writes a second financial operation ledger. Existing
example installations should follow the
[cutover runbook](example-balance-funding-cutover.md) before retiring legacy
records. The stateless methods above remain supported.

When using those stateless methods, serialize changes per subscription in the host. Persist the operation identity
before the provider call, reuse it after a timeout or host write failure, and use
a new identity for each later enable/disable cycle. An unfinished operation must prevent an opposite change from racing it; retry
the pending change first. Preserve the preparation through retries. Keys must be
nonempty, contain no line breaks, and be at most 247 characters because the package
adds phase suffixes. Stripe's idempotency retention window still applies.

Only eligible processing earnings can fund these subscriptions; top-ups cannot.
Insufficient available balance in the invoice currency fails payment and does not
automatically charge a saved card. Handle `invoice.payment_failed` in your host
and offer an explicit alternate-method recovery flow. These operations neither
pay an overdue invoice nor change payout schedules. See Stripe's
[balance-payment eligibility, approval and recovery guidance](https://docs.stripe.com/payments/pay-with-balance).

### Upcoming invoice preview

Authorize the customer account and subscription in your host action, then call
`stripe.getUpcomingInvoicePreview(ctx, { customerAccount, stripeSubscriptionId })`.
The method verifies that the subscription belongs to that account and uses your
configured Stripe API version. It retrieves every invoice line, returns integer
minor-unit amounts and millisecond timestamps, and preserves Stripe errors,
including unavailable previews. Failed pagination throws instead of returning a
partial estimate. `nextBillingAt` uses Stripe's next payment attempt, trial end,
or earliest subscription-item renewal date, in that order.

Pass the result through an authenticated callback to the React `InvoiceEstimate`
component. It displays the provider `total` without summing line amounts. Totals
can include discounts, tax or credits; `amountDue` can differ from `total` because
of customer balances. Previews are estimates, not payable invoices. Application
recovery costs and credits remain host-owned policy. See Stripe's
[invoice preview documentation](https://docs.stripe.com/api/invoices/create_preview).

### Invoice, Payment Method, and Payout

| Method                                                                               | Description                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `getInvoice(ctx, { stripeInvoiceId })`                                               | Get invoice by Stripe invoice ID                                                           |
| `getInvoiceByStripeId(ctx, { stripeInvoiceId })`                                     | Alias for getInvoice                                                                       |
| `listInvoices(ctx, { stripeAccountId?, userId?, subscriptionId?, status?, limit? })` | List invoices with optional filters                                                        |
| `listInvoicesByUser(ctx, { userId })`                                                | List all invoices for a user                                                               |
| `getInvoiceFromStripe(ctx, { stripeInvoiceId })`                                     | Fetch latest invoice data directly from Stripe                                             |
| `getUpcomingInvoicePreview(ctx, { customerAccount, stripeSubscriptionId })`          | Preview the next invoice with complete lines, provider totals and millisecond dates        |
| `listPaymentMethods(ctx, { stripeCustomerId, type? })`                               | List saved payment methods                                                                 |
| `attachPaymentMethod(ctx, { paymentMethodId, stripeCustomerId })`                    | Attach a payment method to a customer account                                              |
| `detachPaymentMethod(ctx, { paymentMethodId })`                                      | Detach a payment method                                                                    |
| `setDefaultPaymentMethod(ctx, { stripeAccountId, paymentMethodId })`                 | Not supported for V2 accounts — throws with guidance to use `createBillingPortalSession()` |
| `createBillingPortalSession(ctx, { stripeAccountId, returnUrl })`                    | Create a Stripe billing portal session URL                                                 |
| `createPayout(ctx, { stripeAccountId, amount, currency?, metadata? })`               | Create a payout for a Connect account                                                      |
| `getPayout(ctx, { payoutId })`                                                       | Get payout by component document ID                                                        |
| `listPayouts(ctx, { stripeAccountId?, status?, limit? })`                            | List payouts with optional filters                                                         |

### Refund and Dispute

| Method                                                                                                                                                   | Description                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createRefund(ctx, { stripePaymentIntentId?, stripeChargeId?, amount?, reason?, metadata?, stripeAccountId?, refundApplicationFee?, reverseTransfer? })` | Issue a refund (provide a payment intent or charge); returns/reverses the platform fee and destination transfer by default; synced via `refund.created`/`.updated` |
| `getRefundByStripeId(ctx, { stripeRefundId })`                                                                                                           | Get a refund by Stripe refund ID                                                                                                                                   |
| `listRefunds(ctx, { stripeAccountId?, stripePaymentIntentId?, status?, limit? })`                                                                        | List refunds with optional filters                                                                                                                                 |
| `paginateRefunds(ctx, { paginationOpts, stripeAccountId?, stripePaymentIntentId?, status? })`                                                            | Added after 0.16.0: bounded newest-first refund cursor pages with conjunctive host-authorized scopes; verify release before adoption                               |
| `getDisputeByStripeId(ctx, { stripeDisputeId })`                                                                                                         | Get a dispute by Stripe dispute ID                                                                                                                                 |
| `getDisputeWithCountdown(ctx, { stripeDisputeId })`                                                                                                      | Get a dispute plus its evidence-due countdown (`daysRemaining`, `isOverdue`)                                                                                       |
| `listDisputes(ctx, { stripeAccountId?, stripePaymentIntentId?, status?, limit? })`                                                                       | List disputes with optional filters                                                                                                                                |
| `uploadDisputeEvidence(ctx, { stripeDisputeId, actor, field, file, stripeAccountId? })`                                                                  | Since 0.14.0: validate and upload file bytes, then attach the returned file ID to an authorized dispute draft; never submits                                       |
| `updateDispute(ctx, { stripeDisputeId, evidence?, metadata?, submit?, stripeAccountId? })`                                                               | Submit/stage dispute evidence (`submit: true` finalizes the response)                                                                                              |
| `closeDispute(ctx, { stripeDisputeId, stripeAccountId? })`                                                                                               | Accept a dispute (concede the chargeback) — irreversible                                                                                                           |
| `reverseTransfers(ctx, { sourceChargeId, percent?, amount?, operationId? })`                                                                             | Reverse split/destination transfers for a charge (the primitive behind automatic dispute clawback; also callable manually)                                         |

`uploadDisputeEvidence` shipped in [0.14.0](https://github.com/FantasticDevHQ/better-stripe/releases/tag/v0.14.0).
Call it from an authenticated server adapter with a session-derived actor. A seller
can upload only for a dispute whose sale belongs to their merchant account.

```ts
const { stripeFileId } = await stripe.uploadDisputeEvidence(ctx, {
  stripeDisputeId,
  actor: { type: "seller", accountId: authorizedSellerAccountId },
  field: "customer_communication",
  file: {
    data: evidenceBytes, // Uint8Array loaded from authorized private storage
    name: "communication.pdf",
    type: "application/pdf",
  },
});
```

The API accepts nonempty PDF, JPEG or PNG bytes up to 5,000,000 bytes, with a
matching MIME type and file signature. Stripe validates the complete document.
Authorization runs before upload and again before attachment. Only the returned
provider file ID is bound to the chosen evidence field, with explicit
`submit: false`. The result contains `stripeFileId` and `stripeDisputeId` after
attachment succeeds. Use a separate authorized `updateDispute` call with
`submit: true` when the user explicitly finalizes evidence.

The optional `stripeAccountId` identifies the provider account owning the charge;
it is distinct from the seller actor. Resolve it server-side. Do not accept
browser-provided actors or file IDs as authorization. See the
[upload workflow guide](react-workflows.md#dispute-evidence-uploads-and-onboarding-navigation)
for errors, retries and storage/transport limits.

Refunds denormalize cumulative state onto the linked `payments` row (`refundedAmount`, `refundStatus: "partially_refunded" | "fully_refunded"`) so "is this payment whole?" is a single read.

### Operational

| Method                                                                                    | Description                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `syncAllAccounts(ctx)`                                                                    | Sync all V2 accounts from Stripe to component DB                                |
| `syncAllProducts(ctx)`                                                                    | Sync all products and prices from Stripe                                        |
| `syncAllSubscriptions(ctx)`                                                               | Sync all subscriptions from Stripe                                              |
| `setupEventDestination(ctx, { url, eventPayload?, name?, description?, enabledEvents? })` | Create or update a V2 event destination (snapshot or thin)                      |
| `listEventDestinations(ctx, { limit? })`                                                  | List all V2 event destinations                                                  |
| `listWebhookEndpoints(ctx, { limit? })`                                                   | List V1 webhook endpoints                                                       |
| `createWebhookEndpoint(ctx, { url, description?, enabledEvents? })`                       | Create a V1 webhook endpoint                                                    |
| `webhookHandlers()`                                                                       | Returns the `{ syncWebhook, asyncWebhook }` pair to export from a Convex module |

### Standalone Function

| Function                                   | Description                                                |
| ------------------------------------------ | ---------------------------------------------------------- |
| `registerRoutes(http, component, options)` | Register the webhook HTTP endpoint on a Convex HTTP router |

## Verified settlement and payout APIs

`getVerifiedSale`, `allocateSale`, `selectCommissionInvoice`, and `settleSale`
provide verified fees, fee-first allocations, durable subscription commission
terms, and recoverable execution through the component's existing transfer ledger.
`getPayoutSnapshot` supplies per-currency balances, real cursor history, and
explicitly bounded upcoming payout data. See [settlement and payout contracts](settlement.md)
for authorization, recovery, migration, and provider limitations.

Account creation (`createAccount`, `getOrCreateAccount`, `ensureCustomerAccount`),
`createCheckoutSession`, `createProduct`, and `createPrice` accept an optional `idempotencyKey`. Use one stable
account-creation key per logical account and a distinct key per checkout order.
For catalog edits, persist a request key for the logical product or immutable
price version. Retry identical parameters with the same key after a provider or
component persistence failure. Use a new key when the price amount or other
creation parameters change. Creating a new Price does not migrate existing
subscriptions; they retain their prior price until the host explicitly changes
them. Never reuse a version key for different parameters.

`updateProduct` and `deactivateProduct` also accept an optional `idempotencyKey`,
including through the example's product actions. It is a Stripe request option,
not product metadata. Persist one key for an intentional SET and reuse it only
for identical provider parameters; a later intentional change needs a new key.
Omitting it preserves Stripe SDK behavior, including automatic retry keys.

For these v1 product POSTs, Stripe retains the first executed response, including
`500` failures. A concurrent execution conflict does not establish completion;
the SDK preserves that error. Keys may be removed after at least 24 hours, and a
subsequent reuse can execute again. The host must bound retries before that
window, retain unresolved operations beyond its cutoff, and serialize conflicting
business operations itself. This option does not provide a host command ledger
or an unlimited exactly-once guarantee. Provider errors never trigger a new-key
retry in these methods. See [Stripe's idempotency contract](https://docs.stripe.com/api/idempotent_requests).

React `Checkout` preserves its request ID through retries; your server must
forward that identity as the SDK request option. Persist it in the host order
for recovery across reloads. Omission retains the previous SDK behavior.

Keys must be nonempty, at most 255 characters, and contain no sensitive data.
Reuse a key only with identical parameters. Stripe v1 Checkout keys can be pruned
after 24 hours; Accounts v2 deduplicates within 30 days. Maintain durable order and
account mappings beyond those windows, and reconcile ambiguous provider results
before retrying an expired key. See [v1 idempotency](https://docs.stripe.com/api/idempotent_requests)
and [v2 request semantics](https://docs.stripe.com/api-v2-overview).

`getCheckoutSessionFromStripe`, `getSubscriptionFromStripe`, and `getCouponFromStripe` read
current provider objects rather than cached component records. They are server
APIs: authorize each resource and return only the fields your browser needs.
Subscription upserts accept Stripe's `incomplete_expired` terminal status.

### One-time intents and saved-card setup

`createPaymentIntent(ctx, { userId, customerAccount?, stripePriceId,
idempotencyKey, receiptEmail?, metadata? })` creates a card-only, platform
PaymentIntent by default. Set `paymentMethods: "automatic"` to let Stripe select
compatible methods, as in the example. It retrieves the platform price and expanded product from Stripe,
rejects inactive products/prices, recurring and nonpositive/nonfixed prices, and
derives amount and currency from the provider price. It returns only
`{ paymentIntentId, clientSecret }`. Omit `customerAccount` for a host-authorized
guest purchase. Existing Checkout Sessions integrations remain available.

`createSetupIntent(ctx, { userId, customerAccount, usage, consent: true,
idempotencyKey, metadata? })` provisions a card-only SetupIntent for a V2 customer
account, returning only `{ setupIntentId, clientSecret }`. Explicitly choose
`on_session` or `off_session` and record consent to that usage before provisioning.
Confirmation attaches the saved card after required authentication; it does not
set a subscription default. `SaveCard` from the React entrypoint supplies an
unstyled Payment Element workflow. See the [React guide](react-workflows.md#save-a-card-through-setupintent-confirmation).

Both APIs require caller idempotency keys. Persist logical request identity and
immutable inputs on the server, bind keys to the authenticated customer and
operation, and reuse the same key on retries. Stripe's bounded idempotency window
is not a durable order store. Authenticate in the host adapter, authorize the
selected price/product and customer, and supply server-selected metadata. The
package checks a supplied customer account's persisted `userId` ownership,
protects its own attribution keys and strips the reserved `bs*` namespace. Never
accept browser-provided amounts, user IDs or metadata as authorization.

Grant paid access only after the existing verified webhook/settlement flow.
Creation and browser confirmation are not settlement proof. Customer-account
operations require Accounts v2 support in the sandbox or merchant account; the
[customer preview guide](accounts-v2-preview.md) explains eligibility.

#### Live sandbox verification, 2026-10-15

The public intent APIs and `SaveCard` passed real Stripe test-mode verification
at commit `332d49c`, merged in [PR #166](https://github.com/FantasticDevHQ/better-stripe/pull/166).
Browser 3DS failure, retry on the same SetupIntent, and successful authentication
passed. A card saved for `off_session` use then succeeded on a later PaymentIntent;
all successful test payments were refunded. Provider checks also covered customer
ownership, redisplay permission, idempotent retries and declines.

The initial `non_connect_platform_accounts_v2_access_blocked` error was resolved
by enabling Connect in the intended Connect test sandbox. The browser flow used
`2026-09-30.endive`; separate API checks also passed on `2026-09-30.preview`.
This does not establish customer-only preview eligibility for another account.
See the [sandbox setup findings](accounts-v2-preview.md#connect-sandbox-setup-findings-2026-10-15),
[authentication and reuse results](react-workflows.md#live-authentication-and-reuse-results-2026-10-15),
and [uploaded screenshots and provider records](https://github.com/FantasticDevHQ/better-stripe/pull/166#issuecomment-6185124292).

## Reversal history and revision maintenance

`stripe.reversalObservations` reads original claimed-slice history and maintains a bounded diagnostic index. Its physical operation references survive release/deletion and distinguish reuse of a business operation ID. Exact bucket/owner pages, original/latest payloads and generation-aware continuation remain unknown coverage. These methods do not execute reversals, certify current ownership or authorize closure. See [financial observations](financial-observations.md#claimed-reversal-slice-history).

`stripe.payoutRevisionMigration` exposes trusted-host `activateAccount`, `begin`, `resume`, `get` and `results`. Existing destinations keep legacy revision authority until explicitly activated. Activation and inventory are bounded storage maintenance, with held outcomes for ambiguous or unrepresentable legacy authority. Installing the package does not run a migration. See the [migration guide](payout-revision-migration.md) before relying on the tested large-operation path or changing component versions.

### Strict catalog identity

`getProductIdentity(ctx, { stripeProductId })` and
`getPriceIdentity(ctx, { stripePriceId })` return the public discriminated types
`ProductIdentityResult` and `PriceIdentityResult`. They distinguish `missing`,
`unique` with the actual cached row, and `ambiguous`, using at most two indexed
row reads and no Stripe request. The [read contract](read-contracts.md#bounded-product-and-price-identity)
explains duplicate handling and the host authorization boundary. Existing
provider-ID getters keep their first-row semantics.

## Native metered billing

`stripe.usage` groups the shared ledger/delivery APIs and all three model
controllers. Start with [typed model recipes](metered-usage.md) and
[setup](metering-setup.md). Follow the domain contracts for [catalog](usage-catalog.md),
[subscriptions](usage-subscriptions.md), [ledger](usage-ledger.md),
[delivery](usage-delivery.md), [observations](usage-observations.md),
[allowances/limits](usage-limits.md), [paid credits](usage-credits.md),
[corrections](usage-corrections.md) and [settlement](usage-settlement.md).
These are trusted host APIs. Browser-selected payer, realm, meter or provider
references do not establish authorization.
