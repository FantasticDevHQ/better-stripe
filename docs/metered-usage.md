# Metered usage feasibility

Status: investigation in progress, reviewed 2026-10-18. BetterStripe does not yet
expose operational metered billing APIs. Configuration and quantity helpers are
available at `@fantastic.dev/better-stripe/usage`. All three models are required. Provider
feasibility must establish a compatible architecture before provider-specific
catalog, delivery or UI implementation.
This document records the native sandbox evidence, repeatable probes and remaining
compatibility questions. Invoice finalization and settlement remain unverified.

## Existing integration constraints

BetterStripe subscriptions use Accounts v2 `customer_account` identities through
the platform Stripe client. See `src/client/billing/subscriptions.ts` and
[financial ownership](financial-ownership.md). Adding a separate v1 Customer is a
new identity/payment-method mapping contract, not an interchangeable identifier.
Existing fixed-price subscriptions, checkout and settlement must keep working.

Hosts authorize actors, payers and sellers and decide which activity is billable.
BetterStripe will own durable acceptance, deduplication, delivery and reconciliation.
A provider receipt cannot authorize a tenant or prove that usage was invoiced.
Seller and affiliate settlement must continue to use verified paid-invoice
proceeds and original payment provenance.

## Provider comparison

| Concern           | Stripe Billing Meters                                                                                                                             | Metronome with Stripe                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Provider guidance | Stripe directs new usage integrations to Metronome, including existing flat-rate subscriptions adding usage                                       | Recommended evaluation path for new usage integrations                                                                       |
| Credentials       | Existing Stripe key, subject to permissions and API access                                                                                        | Separate Metronome sandbox/account token and explicit Stripe integration enrollment                                          |
| Payer identity    | Guide maps meter payloads to Stripe Customer IDs; installed Stripe 23.0.0 meter types expose `by_id` only                                         | Documented invoice delivery configuration uses `stripe_customer_id` with a `cus_` ID                                         |
| Accounts v2       | Platform sandbox mapping to `cus_`, aggregates and invoice-preview payer identity verified; other modes remain unverified                         | `customer_account` invoice delivery remains unverified; ingest aliases alone do not establish payment identity               |
| Connect           | Stripe documents connected-account requests and different rate limits; this does not prove a platform-owned Accounts v2 payer works in that realm | Multi-entity connections are documented; equivalence to Connect destination charges or separate transfers remains unverified |
| Catalog           | Meter attached to recurring metered price                                                                                                         | Billable metric, product, rate card and customer contract                                                                    |
| Invoices          | Stripe owns subscription invoicing                                                                                                                | Metronome rates usage and pushes separate invoices to Stripe, including when recurring subscriptions coexist                 |
| Cost/access       | Confirm account eligibility and current Billing pricing before selection                                                                          | Confirm enrollment, commercial terms and extra credential acceptance before selection                                        |

Native Stripe Billing Meters is the default implementation target for BetterStripe.
It uses the existing Stripe integration and credentials, with native sandbox
aggregation and invoice-preview evidence for all three models. Metronome remains an
optional comparison, not a setup prerequisite. See the [developer and AI-agent setup
guide](metering-setup.md). Remaining account/settlement gaps must be verified before
claiming compatibility for those flows.

## Required billing models

BetterStripe must provide simple typed package APIs and reusable UI for:

- Pay-as-you-go.
- Included monthly usage with overages.
- Prepaid credits.

Developers configure units, precision, rates, intervals, allowances and credit
policies for their apps. No global first billable unit or single-model choice is
required. Share durable usage acceptance, delivery, scoped readers and
reconciliation across the three models. The example app must demonstrate a
complete runnable flow for each through package APIs and package React components.

Purchased prepaid credits require verified successful payment before becoming
spendable. Reuse existing payment/funding/recovery contracts where applicable and
avoid a duplicate monetary wallet. Define credit reservation, consumption,
expiration, refund and dispute behavior explicitly. Provider aggregates and invoice
previews are estimates and cannot enforce a strict real-time limit.

## Provider feasibility by model

| Model                                | Billing Meters candidate                                        | Metronome candidate                                     | Required proof                                                                  |
| ------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Pay-as-you-go                        | Meter, recurring usage price and subscription invoice           | Metric, usage rate and contract invoice                 | Authorized payer, aggregate, rated invoice and original payment                 |
| Included monthly usage plus overages | Tiered usage price or explicit allowance/rating integration     | Contract allowance/credit configuration plus usage rate | Reset, allowance boundary, overage and no double billing                        |
| Prepaid credits                      | Billing credit grants applied to eligible metered invoice lines | Payment-gated prepaid commitments                       | Successful purchase, grant, consumption, exhaustion and refund/dispute recovery |

The native sandbox has verified aggregation and invoice previews for all three
mechanisms. Finalized billing, complete credit accounting and remaining account
modes still require verification. All three models remain required. Stripe billing credit grants apply to eligible
metered subscription invoices at finalization; they do not themselves implement
an atomic real-time access limit. Verify the provider credit rules against the
existing marketplace settlement contracts before using them for seller flows.

Stripe documents that Accounts v2 subscription responses include both a mapped
`customer` and `customer_account`, and that `/v1/customers` supports account IDs.
Investigate this provider-owned mapping for meter ingestion instead of provisioning
a separate payer. Verify exact account ownership and provider realm before adoption.

## Shared configuration contracts

`defineUsagePlan` validates and copies a model's terms. It does not provision a
meter, authorize a payer, record usage, enforce limits or charge a customer.
The `rate.unitAmountDecimal` is a decimal string of minor currency units per whole
billable unit. It accepts up to 12 integer and 12 fractional digits. Currency codes
must contain three lowercase letters; adapters must additionally verify actual
currency/provider eligibility. Treat a plan key/version as immutable once used.

```ts
import {
  defineUsagePlan,
  parseUsageQuantity,
} from "@fantastic.dev/better-stripe/usage";

const terms = {
  key: "api_requests",
  version: "v1",
  unit: { name: "request", precision: 0 },
  rate: { currency: "usd", unitAmountDecimal: "2" },
};
const payAsYouGo = defineUsagePlan({ ...terms, model: "pay_as_you_go" });
const included = defineUsagePlan({
  ...terms,
  model: "included_overage",
  includedQuantity: "1000",
  reset: "billing_period",
});
const prepaid = defineUsagePlan({
  ...terms,
  model: "prepaid",
  insufficientBalance: "reject",
});
const exact = parseUsageQuantity("123", payAsYouGo.unit.precision);
// exact.scaledQuantity is "123", a JSON/Convex-safe integer string.
```

The initial shared quantity contract supports 0–6 decimal places, nonnegative
canonical decimal strings, and at most 18 digits in the scaled integer. It rejects
rounding, exponent notation and JavaScript numeric inputs. A provider adapter must
apply its own tighter bounds before accepting usage. `parseUsageQuantity` removes
trailing fractional zeros and preserves exact values beyond JavaScript's safe
integer range. Provider/catalog, delivery and reservation APIs remain unfinished.

## Native event scope and identity

`prepareUsageRecord` validates and snapshots a native event before persistence.
Its scope contains `stripeAccountId` for the Stripe realm, `customerAccount` for
the Accounts v2 payer, `meterId`, and `livemode`. The binding preserves the mapped
`stripeCustomerId`, `stripePriceId`, native `eventName`, pinned API version and
full plan/version terms. The host must authorize and verify these references on
the server. Passing validation does not prove ownership or provider eligibility.

Use one stable `sourceEventId` per real activity. The deduplication identity covers
test/live mode, realm, payer, meter and that source ID. Plan changes, mapped-customer
changes and quantity/time corrections do not create a new identity; acceptance must
compare the original immutable event and reject conflicting replay. Occurrence
time is Unix seconds. Adapters must enforce Stripe's supported event windows and
retain original time, rather than replacing it with the retry time.

`UsageDeliveryState` distinguishes queued, sending, provider-accepted, rejected,
unknown and held delivery. Locally recorded acceptance is the ledger transaction;
provider acceptance is only a receipt. Aggregation and invoicing require independent
reconciliation evidence. An adjustment retains the original event and receipts.
A finalized/paid invoice is not inferred from a delivery state or preview. These
contracts prepare the shared ledger/delivery work; they do not implement it.

## Access preflight

From the repository root, inject a sandbox key as `STRIPE_SECRET_KEY` and run:

```sh
node scripts/metering-feasibility.mjs
```

Use `op run` from one persistent authorized terminal when the key is in 1Password.
Do not print or save the key. The script rejects non-test secret keys before making
any request. It makes one platform-realm GET to `/v1/billing/meters?limit=1`, pins
the repository's Stripe version and prints only status and verification flags.
It creates no meters, customers, events, subscriptions, invoices or charges.

A successful response establishes endpoint access only. A 401 or 403 is an access
failure, not evidence that a billing identity or model is unsupported. The script
has no connected-account selector and does not test that realm. It is a development
tool in the repository, not a public package API.

## Three-model sandbox runner

```sh
node scripts/metering-sandbox.mjs
# Explicit optional test-card purchase proof, refunded during cleanup:
node scripts/metering-sandbox.mjs --verify-test-payment
```

Inject a test key into the process environment. Both paths reject live keys before
networking. Each run creates an isolated Accounts v2 payer and three independent
meter/product/price/subscription sets. It verifies the provider-owned customer
mapping, sends 15 units twice with one event/idempotency identity and polls bounded
usage summaries before previewing each invoice. No invoice is explicitly finalized.

The default credit grant is promotional, so it does not prove a paid purchase.
The optional flag creates a 100-cent sandbox PaymentIntent with Stripe's test card.
Only a verified succeeded payment for the exact payer, currency and received amount
permits a paid credit grant. Cleanup expires credits, refunds the successful test
payment, cancels subscriptions without invoicing/proration, archives prices/products
and deactivates meters. Test payer records and historical provider evidence remain.
Cleanup success means the corresponding API request succeeded, not that an
asynchronous refund has settled. A failed run can leave test resources requiring
operator cleanup; never rerun an old operation as a new live payment.

## Sandbox acceptance matrix

Run the following with sandbox credentials and the confirmed three-model scope. Capture
sanitized request shapes, API versions, timestamps, status codes and assertions.
Keep secrets and raw customer/provider payloads out of evidence and workflow state.

| Scenario                   | Required proof                                                                                                               | Current result                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Platform Accounts v2 payer | Meter/contract creation, ingestion, aggregate and invoice all refer to the authorized payer                                  | Unverified                                               |
| Connected seller           | Prove catalog/event realm and payer ownership, destination/transfer economics and paid-invoice provenance                    | Unverified                                               |
| Non-Connect account        | Prove identity and invoice flow without silently provisioning an alternative payer                                           | Unverified                                               |
| Duplicate delivery         | Same source event and provider identifier produce one aggregate contribution                                                 | Unverified                                               |
| Shared meter               | Two subscriptions for one customer show the actual aggregation boundary; no inferred per-subscription event targeting        | Unverified                                               |
| Correction                 | Original event, reason and receipt retained; provider cancellation window and finalized-invoice behavior demonstrated        | Unverified                                               |
| Invoice closeout           | Original event time, delayed aggregate, finalized invoice line and payment/processing costs reconcile                        | Unverified                                               |
| Test clocks                | Determine which provider clock drives event timestamps and invoice periods, without assuming virtual time advances ingestion | Unverified                                               |
| Packed consumer            | Verify eventual public contracts from the built tarball with linked guides present                                           | Configuration helpers verified; operational APIs pending |

For Billing Meters, event uniqueness is enforced for at least a rolling 24-hour
window. Acceptance permits timestamps within 35 calendar days in the past or five
minutes in the future. Cancellation is limited to events sent within 24 hours.
Aggregation is asynchronous. Accepted late events can appear in summaries without
changing a finalized invoice. Preserve local deduplication and an explicit unknown
delivery state beyond the safe retry window. Events have no subscription selector.

Metronome's quickstart uses a customer UUID or ingest alias and transaction ID,
string-valued numerical properties and a 34-day backdating window. Confirm exact
retention, correction and retry guarantees for the chosen API and account before
encoding them as constants. Its invoice integration documentation and Stripe's
integration overview use different metadata names for invoice mapping. Inspect the
actual sandbox invoice rather than trusting a single assumed metadata key.

## Evidence recorded so far

On 2026-10-18 the platform sandbox returned HTTP 200 for the meter access preflight.
The three-model run on `2026-09-30.endive` verified the provider-owned Accounts v2
mapping, catalog/subscription creation, event acceptance, an aggregate of exactly
15 units after identical retries, and invoice-preview payer identity for each model.
Preview totals were 30 cents for pay-as-you-go at 2 cents/unit, 10 cents after a
10-unit free tier, and zero after a 100-cent promotional grant.

All thirteen requested cleanup operations succeeded. No real customer email was
used. These observations are platform-scope test evidence. They do not prove
Connect seller flows, non-Connect preview enrollment, paid purchases, finalized
invoices, payment/processing costs, corrections or marketplace settlement. The
optional purchase probe is separate and must be recorded explicitly when run.
Metronome is optional and has not been provisioned. Native Stripe is the implementation target; all three models remain in scope.

The configuration/quantity tests cover all three models, invalid terms, exact
values beyond safe integers and caller-mutation isolation. A packed consumer test
loads the real `./usage` export and exercises the same three configurations.

## Primary sources

- [Stripe usage-based billing](https://docs.stripe.com/billing/usage-based)
- [Stripe's guidance on recording usage](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage)
- [Record usage with the API](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api)
- [Create a meter event](https://docs.stripe.com/api/billing/meter-event/create)
- [Configure meters and corrections](https://docs.stripe.com/billing/subscriptions/usage-based/meters/configure)
- [How Metronome works with Stripe](https://docs.stripe.com/billing/how-metronome-works-with-stripe)
- [Metronome API quickstart](https://docs.metronome.com/guides/get-started/api-quickstart)
- [Metronome invoice integration](https://docs.metronome.com/integrations/invoice-integrations/stripe)

- [Accounts v2 customer interoperability](https://docs.stripe.com/accounts-v2/use-accounts-as-customers)
- [Stripe billing credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits)

A later optional purchase run verified a succeeded 100-cent sandbox payment for
the exact payer/currency, created a paid grant and requested its refund. All 14
cleanup calls succeeded. Its prepaid aggregate was 15 and preview total was zero;
its included-usage aggregation did not catch up before the polling bound. This
later run is not a second complete three-model aggregation proof. Neither run
finalized a metered invoice or verified seller settlement.

## Host authorization and observation contracts

`authorizeUsageRecord` prepares a server-resolved event, invokes the host's
`authorize` callback for its exact scope, then `authorizeActivity` for the source
activity, and only then calls the supplied acceptance function. A denial throws
before acceptance. Resolve bindings and activity identity on the server; copying
browser-supplied payer, price or quantity into the helper is not authorization.
The component APIs are trusted host boundaries. Never export their mutations as
unauthenticated application endpoints.

```ts
import {
  authorizeUsageRecord,
  type UsageAuthorization,
  type PreparedUsageRecord,
} from "@fantastic.dev/better-stripe/usage";

type Context = { userId: string; customerAccount: string; activityId: string };
const policy: UsageAuthorization<Context> = {
  async authorize(ctx, { scope }) {
    if (!ctx.userId || ctx.customerAccount !== scope.customerAccount)
      throw new Error("Unauthorized usage scope");
  },
  async authorizeActivity(ctx, record) {
    if (record.sourceEventId !== ctx.activityId || record.quantity !== "1")
      throw new Error("Activity is not billable under these terms");
  },
};
declare const ctx: Context;
// Resolve this from authenticated activity and verified native billing bindings.
declare const serverRecord: unknown;
// Supply the component's atomic acceptance adapter when implementing the ledger.
declare const accept: (record: PreparedUsageRecord) => Promise<string>;
const eventId = await authorizeUsageRecord(ctx, policy, serverRecord, accept);
```

The same adapter handles each of the three configurations above. Hosts own actor,
tenant, entitlement and billable-activity policy. The component owns deduplication,
financial history, delivery and credit accounting. Credentials remain in host
internal actions. They must never enter records, workflow arguments or receipts.

`UsagePageRequest` uses a half-open `[start, end)` period in Unix seconds, an opaque
cursor and a limit of 1–100. `validateUsagePageRequest` rejects invalid intervals,
unsafe timestamps and oversized cursors. Every page must reauthorize the original
scope and period. Readers must distinguish an incomplete scan from a complete
zero total; never sum different currencies or pricing versions implicitly.

`UsageObservations` keeps local acceptance, provider acceptance, aggregation,
estimates and invoice observations separate. `UsageAvailability` explicitly
represents unsupported and unavailable provider/account modes, reason and retry
policy. Missing observations are not zero. `observedAt` is Unix seconds;
acceptance timestamps are assigned by the component, independently of original
occurrence time. Native v1 delivery uses sum aggregation and integer scaled units;
price conversion must preserve the configured whole-unit rate exactly or reject
unsupported precision. A provider acceptance receipt is not aggregation or payment.

## Corrections, retention and transitions

`UsageCorrectionRequest` identifies the original scope/source event, an immutable
correction ID and reason. Cancellation retains the original quantity, timestamp,
provider event identifier and every receipt. A replacement uses a new source event
only after cancellation is confirmed; finalized invoice changes require explicit
billing adjustments rather than silently rewriting usage. Native cancellation
windows and uncertain responses can produce unsupported or held results. No
financial outcome follows merely from requesting a correction.

`UsageRetentionPolicy` retains financial evidence. Retention of temporary execution
payloads may be configured separately, but cleanup must preserve event identities,
pricing snapshots, unresolved receipts, payments, reservations and correction
links. There is no automatic financial-history deletion contract. Bounded pages
and per-scope quotas apply before acceptance; an exhausted quota rejects new work
without deleting old evidence. Large-volume exports retain original identities
and must be reconciled before any future explicit archival feature.

`UsageTransitionRequest` drains pending usage and resolves reservations before an
explicit effective boundary. Versions are immutable. A model/rate/unit/currency
change creates a new version and native price; existing credit grants retain their
original terms. No implicit currency conversion, credit conversion, subscription
migration or historical re-rating is permitted. `assertUsageReplay` compares
normalized immutable terms and rejects changed replay on the original identity,
including time, currency, mapped customer and version. A transition must never
turn a prepaid consumption into a new pay-as-you-go charge.

These are shared contracts and host-boundary helpers. Runtime catalog, acceptance,
delivery, correction and transition adapters are implemented in subsequent tickets.

`UsageContractPort` defines shared `record`, paginated `read`, `reconcile` and
`capabilities` requests/results for host adapters. `record` is an atomic local
acceptance receipt; `read` returns bounded history, not provider completeness;
`reconcile` returns independent observations and never resends events to repair a
mismatch. Check capabilities and availability for the selected scope. These
interfaces specify the adapters being implemented, not an available engine.

`UsageSubscriptionBinding` ties the verified native subscription/item and monthly
period to its price. Store it as immutable routing provenance when accepting
usage. Invoice IDs are later observations because the invoice may not exist at
acceptance. `UsageCreditProvenance` ties a reservation/allocation to its original
grant, verified purchase PaymentIntent, currency, amount, unit quantity and plan
version. A grant may cover multiple events; an event may allocate several grants.
Never fabricate one purchase/grant from a local balance total.

`UsageCorrectionOutcome` distinguishes request, provider acceptance, confirmed
cancellation, held/unsupported cases and required invoice adjustment. Confirmed
cancellation is an adjustment observation linked to the original event, rather
than overwriting its original delivery or invoice receipt. A requested or
provider-accepted correction must not release spendable credits until confirmed.

The [packed consumer fixture](https://github.com/FantasticDevHQ/better-stripe/blob/main/scripts/fixtures/usage-consumer.ts) compiles concrete authorization and activity callbacks plus record/read/reconcile adapters for all three models against the actual package tarball. It returns alternative model paths and never submits one activity to multiple models.
