# Native usage revenue and settlement

Usage, allowance estimates and prepaid consumption are quantity accounting.
Settle only a verified original cash payment. These methods reuse BetterStripe's
existing allocation, transfer, refund/dispute, processing-cost and affiliate
recovery contracts. They require the existing Stripe credentials; no Metronome
account is needed.

## Authorize the original sale

Authenticate the caller on your server. Resolve the complete Stripe realm, mode,
Accounts v2 payer, mapped Customer, original meter, subscription item, price and
billing period from your trusted records. Authorize the native product's seller,
affiliate and fee settings before applying them. Browser input, current
subscription prices and Stripe metadata do not establish ownership.

Pass runtime credentials only to the provider options. The package pins the
original binding's API version, uses a 15-second HTTP timeout and disables SDK
network retries. It sends no connected-account header: the configured key must
own the requested realm. Use the ordinary direct billing read when you only need
revenue evidence. Creating recipient transfers additionally requires a supported
Stripe Connect separate-charges-and-transfers configuration.

## Pay as you go and included overages

```ts
const original = {
  scope, // Server-authorized realm, payer, meter and mode
  binding, // Immutable plan, API version and native price/customer binding
  subscription, // Original subscription/item/price and monthly period
  period: subscription.period,
  invoiceId,
  paymentIntentId,
  gross, // Expected paid amount in integer minor currency units
};
const provider = { stripeSecretKey: process.env.STRIPE_SECRET_KEY };
const source = await stripe.usage.getInvoiceSale(ctx, original, provider);
if (source.status !== "ready") return source;
// Authorize source.value.stripeProductId and all recipient policy on the server.
return stripe.usage.settleInvoice(
  ctx,
  {
    ...original,
    policy: {
      creatorAccountId: authorizedSellerAccount,
      feeBasisPoints: authorizedFeeBasisPoints,
      affiliate: authorizedAffiliate, // Omit when no affiliate applies
      commissionTerm: "one_time", // Or "forever"; default is forever
      collaborators: authorizedCollaborators,
    },
  },
  provider,
);
```

`getInvoiceSale` is read-only. It verifies the realm/mode, payer mapping, native
sum meter, immutable native price and original finalized invoice line. Complete
bidirectional InvoicePayment history must link exactly one full PaymentIntent
payment to the invoice. The original Charge and BalanceTransaction must reconcile
gross, actual processing fee, currency and net. The returned source retains the
original product/price, meter, subscription/item, period and InvoicePayment ID;
it never substitutes the current subscription's price. Exact native decimal
quantities are checked without converting them to JavaScript floating point.
An archived original price remains valid for historical settlement.

`settleInvoice` repeats those reads, selects commission eligibility, allocates
with the existing fee-first helper and executes through the existing transfer
ledger. The inclusive selling fee has actual processing cost as its floor.
Original native provenance becomes part of the immutable settlement identity.
Retries retain the original allocation even after fee changes. A native transfer
whose persistence failed is recovered before another transfer can be created.

A zero initial invoice creates no commission decision. `one_time` uses the first
paid nonzero invoice from complete native history; delayed webhook delivery does
not turn a later renewal into a second first payment. `forever` applies per paid
invoice. Refunds and disputes do not reset eligibility.

An unpaid draft/open invoice returns `not_ready/provider_pending`. Missing fees
remain `not_ready/fee_pending`. Zero paid invoices and refunded/disputed sources
are not payable. Incomplete or ambiguous funding, credit-funded/partial/multiple
payments, unrelated priced invoice lines, proration, mismatched original periods,
converted settlement currencies and automatic destination/on-behalf-of charges
are held through explicit non-ready outcomes. The method does not guess a
multi-product allocation or take over existing destination-charge fee handling.
Fixed-plus-metered invoices remain readable with the ordinary invoice APIs, but
this automatic settlement method requires one paid original meter line. Native
included-overage invoices can also contain one zero-priced included-tier line.
Both lines must retain the same original price, product, subscription item,
period, currency and mode, with no credit adjustments. The complete independent
line-item read must match both original IDs. Additional paid lines, duplicate IDs
and foreign zero-priced siblings remain unsupported. Treat unsupported settlement
combinations as unavailable evidence rather than zero proceeds.

## Prepaid issuer-service revenue

Native Stripe billing credits are for the issuing business's own products and
services. Stripe prohibits using them as third-party payments or stored-value
wallets. See [Stripe's approved and prohibited uses](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits).

```ts
const revenue = await stripe.usage.getCreditPurchaseRevenue(
  ctx,
  originalPurchase,
  provider,
);
if (revenue.status !== "ready") return revenue;
return stripe.usage.settleCreditPurchase(
  ctx,
  {
    ...originalPurchase,
    policy: {
      affiliate: authorizedIssuerServiceAffiliate,
      feeBasisPoints: authorizedFeeBasisPoints,
    },
  },
  provider,
);
```

`originalPurchase` is the original `UsageCreditPurchaseOptions`, including
`ownership: "issuer"`, quantity and immutable price. A verified paid purchase and
retained grant must already exist. The reader rechecks original purchase
identity, native payer/realm, payment success, refund/dispute eligibility and the
actual processing cost. It returns the original PaymentIntent, Charge, grant,
product/price and purchase ID. It performs no financial writes.

`settleCreditPurchase` keeps the issuer's remaining revenue on its own platform
balance after actual processing costs and any server-authorized affiliate share.
It creates no seller or reseller transfer. Affiliate policy applies to this
original paid purchase/top-up, with exact original-charge replay protection.
A prepaid purchase is a one-time sale rather than an invoice subscription award;
the host decides whether an affiliate applies to each top-up. Consumption,
reservation, cancellation, credit expiry and invoice credit application never
create a second cash sale or affiliate award. An extra seller/collaborator policy
or non-issuer ownership returns `rejected/unsupported_source`.

A pending payment/grant is not revenue available for settlement. A missing
processing fee is not zero. Refunded/disputed purchase proceeds cannot initiate a
new settlement. A ready revenue read is not accounting advice about revenue
recognition or a promise that a native credit may fund another business.

## Recovery and operation boundaries

Continue to use the existing refund/dispute webhooks and [affiliate recovery](affiliate-clawbacks.md).
Both invoice and prepaid purchase settlements retain the original charge and
recipient legs in the same component ledger. Partial refunds accumulate against
those original legs; disputes and won-dispute reinstatement use the existing
recovery reservations. Never calculate clawbacks from current rates or issue a
second commission to compensate for a usage correction.

Before refunding a prepaid purchase, follow [paid-credit recovery](usage-credits.md):
reconcile consumption and disable refundable unspent native credit before using
the original cash-refund API. A usage correction can restore proven quantity
without creating cash. A finalized invoice adjustment uses the [correction and
verified credit-note/refund workflow](usage-corrections.md); it does not erase
valid usage or reopen affiliate eligibility.

Keep original bindings, settlement claims, transfers, grants and recovery history
while any operation can be retried or reversed. Unsupported account combinations
require operator resolution. There is no automatic production migration, live
billing activation, marketplace credit redemption or package publication.

The co-located SDK transport and Convex transaction tests cover original invoice
provenance, fractional quantity, included tiers, zero-first-invoice commission,
transfer-success/persistence-failure, replay, prepaid purchase consumption and
refund guards. These tests are not a new native financial sandbox execution;
project-wide native acceptance is recorded separately.
