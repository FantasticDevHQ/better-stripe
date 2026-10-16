# Invoice payment references

`getInvoicePaymentPageFromStripe` enumerates a known subscription invoice's provider payment records. The host supplies the authorized invoice ID, canonical V2 customer account and expected Stripe subscription ID. BetterStripe retrieves the invoice and verifies all three bindings before requesting any invoice payments, including on continuation pages.

The method returns bounded pages with `hasMore` and a scope-bound `continueCursor`. Stripe's embedded invoice `payments` property contains only a preview. The reader uses the dedicated [invoice payment list endpoint](https://docs.stripe.com/api/invoice-payment/list) instead. A nonterminal empty or nonadvancing provider response fails rather than inventing a cursor or claiming completion. A terminal empty page is valid. Provider failures propagate.

Unsafe, fractional or negative provider amounts and malformed currency identifiers fail rather than returning rounded money evidence. No unit conversion or summation runs in the reader.

Each row retains the provider invoice-payment record's exact currency, requested amount, allocated paid amount and actual status. A canonical PaymentIntent reference has `referenceStatus: "payment_intent"`. Missing or malformed PaymentIntent references are `"unavailable"`; charge-only, payment-record and future payment types are `"unsupported"`. Those rows remain in the page. No records are silently filtered to make a page look complete.

This is a reference reader, not an authorization or refund-eligibility decision. The host must derive its enabled authenticated actor and community permissions, verify original merchant routing against BetterStripe's payment records, and project safe fields before returning data to browsers. A payment reference does not authorize an affiliate or collaborator to refund the merchant's sale. Ownership transfer does not establish historical merchant authority.

Invoice payment `amount_paid` is the amount credited to this invoice. It may be less than the underlying PaymentIntent's received amount if the PaymentIntent pays multiple invoices. It is not the underlying payment's remaining refundable amount. The host must verify that issuing a refund cannot reach money outside the authorized sale, and revalidate eligibility at refund creation. Do not add unlike currencies or treat synchronized refund balances as provider-live balances.

Pending/open and canceled invoice payments, including null or zero paid amounts, retain their actual provider state. Ending enumeration only exhausts that current invoice-payment scope. It does not prove settlement, a complete customer history, an immutable snapshot, a business-history verdict or entitlement cancellation. Provider records can change between requests. Cursor scope binding detects accidental selector changes; the cursor is not an authorization credential.

The method performs no provider writes or local financial mutations. It does not create refunds, reverse transfers, update access or cancel subscriptions. Ordinary refund financial reversals and actor validation remain in the existing refund APIs.

```ts
import {
  BetterStripe,
  type InvoicePaymentPageOptions,
} from "@fantastic.dev/better-stripe";

// Derive these selectors from an authorized server-owned subscription/invoice.
const options: InvoicePaymentPageOptions = {
  stripeInvoiceId,
  customerAccount,
  stripeSubscriptionId,
  limit: 25,
};
const result = await stripe.getInvoicePaymentPageFromStripe(ctx, options);
// result.scope retains the verified invoice, buyer and subscription selectors.
// Continue with result.continueCursor and the same authorized selectors.
```

Public exports include `InvoicePaymentPageOptions` and
`ProviderInvoicePaymentPage`. The Vite server-only binding is
`example/convex/billing/invoicePayments.ts`; the presentation reference is
`example/src/components/invoice-payment-selector.tsx`. Project only the fields
needed by that UI after host authorization, rather than returning raw provider
objects to a browser. Source merge requires a verified published artifact and
explicit Dojo adoption before its refund workflow can consume this API.
