# Metered usage feasibility

Status: investigation in progress, reviewed 2026-10-18. BetterStripe does not yet
expose metered billing APIs. The provider, first billable unit and pricing model
must be selected before implementing provider-specific catalog, delivery or UI.
This document records the compatibility questions and repeatable access preflight.
It does not claim a successful billing sandbox run.

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
| Accounts v2       | `acct_` payer ingestion and invoice identity remain unverified                                                                                    | `customer_account` invoice delivery remains unverified; ingest aliases alone do not establish payment identity               |
| Connect           | Stripe documents connected-account requests and different rate limits; this does not prove a platform-owned Accounts v2 payer works in that realm | Multi-entity connections are documented; equivalence to Connect destination charges or separate transfers remains unverified |
| Catalog           | Meter attached to recurring metered price                                                                                                         | Billable metric, product, rate card and customer contract                                                                    |
| Invoices          | Stripe owns subscription invoicing                                                                                                                | Metronome rates usage and pushes separate invoices to Stripe, including when recurring subscriptions coexist                 |
| Cost/access       | Confirm account eligibility and current Billing pricing before selection                                                                          | Confirm enrollment, commercial terms and extra credential acceptance before selection                                        |

No provider is selected. Evaluate Metronome first because it is Stripe's current
recommendation. Adopt it only after proving the Accounts v2 and settlement
contracts and explicitly accepting the additional service credentials. Keep Billing
Meters as a comparison candidate, not an automatic fallback if access fails.
Neither candidate currently has proven end-to-end support in this repository.

## Pricing-model decision

The product owner must choose pay-as-you-go, included monthly units with overages,
or prepaid credits, and name the first billable unit. Pay-as-you-go is the proposed
smallest starting scope. This proposal is not approval. Other models remain
unselected. In particular, do not create a second wallet or infer prepaid access
rules from the existing balance-funding integration.

Record the unit, decimal precision, aggregation formula, billing interval, currency,
price/version and payer/seller scope with the decision. Host limits and entitlement
rules are separate from an eventually consistent provider usage total.

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

## Sandbox acceptance matrix

Run the following after credentials and product decisions are available. Capture
sanitized request shapes, API versions, timestamps, status codes and assertions.
Keep secrets and raw customer/provider payloads out of evidence and workflow state.

| Scenario                   | Required proof                                                                                                               | Current result                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Platform Accounts v2 payer | Meter/contract creation, ingestion, aggregate and invoice all refer to the authorized payer                                  | Unverified                       |
| Connected seller           | Prove catalog/event realm and payer ownership, destination/transfer economics and paid-invoice provenance                    | Unverified                       |
| Non-Connect account        | Prove identity and invoice flow without silently provisioning an alternative payer                                           | Unverified                       |
| Duplicate delivery         | Same source event and provider identifier produce one aggregate contribution                                                 | Unverified                       |
| Shared meter               | Two subscriptions for one customer show the actual aggregation boundary; no inferred per-subscription event targeting        | Unverified                       |
| Correction                 | Original event, reason and receipt retained; provider cancellation window and finalized-invoice behavior demonstrated        | Unverified                       |
| Invoice closeout           | Original event time, delayed aggregate, finalized invoice line and payment/processing costs reconcile                        | Unverified                       |
| Test clocks                | Determine which provider clock drives event timestamps and invoice periods, without assuming virtual time advances ingestion | Unverified                       |
| Packed consumer            | Verify eventual public contracts from the built tarball with linked guides present                                           | Deferred until public APIs exist |

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

The repository uses Stripe 23.0.0 and pins `2026-09-30.endive`. Its installed meter
creation types permit `customer_mapping.type: 'by_id'`; this is a type inspection,
not proof that Accounts v2 ingestion is supported or unsupported. The access probe
has automated tests covering rejection of live/missing keys, a single read-only
request and sanitization of provider errors. Actual provider access, usage delivery,
aggregation, invoices, payment provenance and Metronome access remain unverified.

## Primary sources

- [Stripe usage-based billing](https://docs.stripe.com/billing/usage-based)
- [Stripe's guidance on recording usage](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage)
- [Record usage with the API](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api)
- [Create a meter event](https://docs.stripe.com/api/billing/meter-event/create)
- [Configure meters and corrections](https://docs.stripe.com/billing/subscriptions/usage-based/meters/configure)
- [How Metronome works with Stripe](https://docs.stripe.com/billing/how-metronome-works-with-stripe)
- [Metronome API quickstart](https://docs.metronome.com/guides/get-started/api-quickstart)
- [Metronome invoice integration](https://docs.metronome.com/integrations/invoice-integrations/stripe)
