# Marketplace economics

The platform is always the merchant of record (Skool-style marketplace model): sellers are Connect recipients, not merchants. This section covers the fee, split, payout, dispute, and refund/descriptor primitives that implement that model. All amounts are minor units (cents).

### Fee Model

`PlatformFeeConfig` is the platform's take on a sale:

```typescript
type FeeTier = { upTo: number | null; percent: number; fixed?: number };
type PlatformFeeConfig = {
  percent: number; // base percentage (0–100)
  fixed?: number; // optional fixed surcharge, minor units
  tiers?: FeeTier[]; // optional; overrides the base by charge amount
};
```

Configure a default at construction (`new BetterStripe(component, { platformFee: {...} })`), and/or pass a per-call `fee` override (type `FeeOverride`, same shape as `PlatformFeeConfig`) to `createCheckoutSession`/`createSubscription` — the override wins. `stripe.resolveFee(override?)` resolves the effective config the same way the client does internally, and `stripe.platformFee` reads the configured default back.

```typescript
import { computeFee } from "@fantastic.dev/better-stripe";

const { feeAmount, percentApplied, fixedApplied, tier } = computeFee(2999, {
  percent: 10,
  fixed: 30,
});
```

`computeFee(amount, config)` picks the first tier whose `upTo` covers the amount (a final `upTo: null` is the catch-all), rounds half-up, and caps the fee at the charge amount. It's exported so an app can preview "platform keeps $X" client-side before checkout.

**How the fee is charged** depends on shape and charge type:

- **Percent-only** fees (`isPercentOnlyFee(config)` — no `fixed`, no `tiers`) map directly to Stripe's `application_fee_percent` on the subscription/PaymentIntent — no per-invoice computation needed.
- **Fixed or tiered** fees can't be expressed as a flat Stripe percentage, so they're computed and applied per invoice (`applyPerInvoiceFee`, at `invoice.created`) or per one-time charge (`applyPerChargeFee`) in the webhook processor, via `application_fee_amount`.
- For synchronously finalized first invoices, `invoice.paid` collects the missed fixed/tiered fee through a partial destination-transfer reversal. See [first-invoice fee handling](overview.md#roadmap--known-gaps).

Fees only apply to **destination charges** (`destinationAccountId` set, or a single-recipient `split`). The **separate-charges-and-transfers** path (multi-recipient `split`) never uses `application_fee` — the platform's cut is realized by transferring less than was charged (see Split Engine below).

### Split Engine

For a sale split across multiple recipients (store + affiliate(s)), pass `split` instead of `destinationAccountId` to `createCheckoutSession`/`createSubscription`:

```typescript
type SplitRecipient = {
  destinationAccountId: string;
  role: "store" | "affiliate" | "other";
  amount?: number; // exactly one of amount/percent
  percent?: number; // percent of the gross charge amount
};

await stripe.createCheckoutSession(ctx, {
  userId,
  stripePriceId,
  mode: "payment",
  returnUrl,
  split: [
    { destinationAccountId: storeAccountId, role: "store", percent: 80 },
    {
      destinationAccountId: affiliateAccountId,
      role: "affiliate",
      percent: 10,
    },
  ],
  fee: { percent: 10 }, // per-call override; omit to use the configured default
});
```

- **A single-recipient `split`** is treated as a plain destination charge (equivalent to `destinationAccountId`) — `application_fee_percent`/`application_fee_amount` applies as above.
- **A multi-recipient `split`** routes via **separate charges & transfers**: the platform charges the full amount, then the webhook engine (`createSplitTransfers`, on `payment_intent.succeeded`/`invoice.paid`) creates one Stripe `Transfer` per recipient with `source_transaction` linkage. No `application_fee` is used on this path — the platform's cut is the remainder after transfers.
- **Subscriptions** re-run the split on every billing cycle (each invoice re-reads the subscription's `split`/`feeConfig` markers), so per-cycle recipient amounts stay in sync with the config at charge time.

The core math is exported for previewing splits client-side:

```typescript
import { computeSplit } from "@fantastic.dev/better-stripe";

const result = computeSplit(10000, { percent: 10 }, [
  { destinationAccountId: "acct_store", role: "store", percent: 80 },
  { destinationAccountId: "acct_affiliate", role: "affiliate", percent: 10 },
]);
// result.transfers: [{ destinationAccountId, role, amount }, ...]
// result.platformFee: the resolver's cut; result.platformRetained: amount − sum(transfers)
```

`computeSplit` throws if the transfers plus the platform fee would exceed the charge amount — the platform is always left with at least its configured cut. Any rounding remainder stays with the platform.

### Payouts

Payouts are **automatic and rolling** (Stripe-managed schedule, via hosted Express onboarding) — there is no manual-withdrawal API. `listPayouts`/`createPayout` track/trigger payouts for a Connect account; `PayoutSchedule` (React) and `useEarnings` (React) surface the recipient's balance and next expected payout, with a link out to the hosted Express dashboard for details. See [React Hooks](react-api.md#react-hooks) and [React Components](react-api.md#react-components).

### Disputes

The platform is merchant of record, so a chargeback lands on the platform's Stripe account even for a seller's sale. The dispute pipeline (all webhook-driven, on `charge.dispute.*`):

1. **Clawback** — a monetary `charge.dispute.created` event uses the disputed charge's original gross amount to calculate affiliate commission exposure. Inquiry/warning, prevented, and already-won payloads do not trigger recovery. Affiliate legs share the original-principal exposure axis with refunds; seller and other legs retain the existing reversal allocation. The dispute ID identifies the operation, and a missing authoritative charge amount causes recovery to retry.
2. **Reinstatement** — if the dispute is won (`.closed` with `status: "won"`, or `.funds_reinstated`), the existing `reinstateTransfers` path creates new transfers from the platform balance. Affiliate restoration uses exact reversal/offset receipts, preserves independent successful refunds, and cancels unpaid dispute debt. Failed or uncertain restoration remains visible until reconciled. See [recovery limitations](affiliate-clawbacks.md#verification-evidence).
3. **Auto-cancel** — on dispute open, the disputed subscription (resolved PaymentIntent → invoice → subscription) is canceled by default (`registerRoutes`'s `autoCancelOnDispute`, default `true`; pairs with `cancelDisputeAtPeriodEnd`, default `false` → cancel-at-period-end, matching the Skool model of "cancel now, remove access at cycle end").

Sellers respond to their own disputes without platform staff involvement, via an embedded Stripe Connect session:

```typescript
// server: expose the account session
export const createDisputeSession = action({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) => stripe.createDisputeSession(ctx, args),
});
```

`stripe.createDisputeSession(ctx, { stripeAccountId })` creates an Account Session scoped to `disputes_list`/`payment_disputes` — mount it with the `ConnectProvider`/`EmbeddedDisputes` React components (see [Embedded Disputes](react-api.md#embedded-disputes-stripe-connect)), or build a custom UI on `updateDispute`/`closeDispute` plus the headless `DisputesList`/`DisputeDetail`/`EvidenceForm` components and `buildDisputeEvidence`/`disputeEvidenceCountdown` helpers (see [React Components](react-api.md#react-components)).

`stripe.reverseTransfers(ctx, { sourceChargeId, percent?, amount? })` is also exposed directly, for manual clawback outside the automatic dispute flow (e.g. a support-initiated partial reversal). The internal engine additionally accepts an `operationId` for a stable Stripe idempotency key (used by the automatic dispute flow); the public method doesn't expose it yet, so a manual call relies on Stripe's default request idempotency.

For commissions tracked by the recovery ledger, generic manual reversal is
rejected. Use `createRefund` for a real refund or `stripe.affiliateRecovery.retry`
for a recovery operation, so existing offsets and uncertain receipts remain
coordinated.

### Affiliate commission accounting

The component stores each original affiliate transfer's commission and currency,
links available payment/invoice references, and separates finalized obligations,
provisional dispute exposure, reserved slices, and confirmed reversals. New
commission reversal operations reconcile exact Stripe receipts after interrupted
ledger writes. Percentage and fixed commissions use the original allocated
amount, with deterministic rounding in integer currency units.

Trusted host APIs under `components.betterStripe.settlement` provide
`queries.listAffiliateObligations` and
`mutations.migrateAffiliateObligations`. Authorize account ownership before
exposing snapshots and restrict migration to operators. Existing rows with
unattributed reversal balances require reconciliation. See the
[API and migration guide](affiliate-clawbacks.md#migration-and-operator-reconciliation).

Insufficient-balance debt is offset atomically against eligible future commissions
in the same currency before transfer creation. Dispute wins restore only actual
reversals/offsets and retain independent refunds. `stripe.affiliateRecovery`
provides snapshots, history, operator retry and legacy review; the reusable
`AffiliateRecovery`/`AffiliateRecoveryHistory` views consume those records.

Affiliate payouts require a stable idempotency key and pass an atomic debt and
reservation gate. An optional `minimumAmount` applies a host-authorized currency
minimum; it is not a discovered provider floor. Transfer reversal does not recall
a completed bank payout, Stripe-managed automatic bank payouts remain outside
this gate, and Global Payouts is unsupported. See the guide for account capability
checks, maintenance jobs and live sandbox verification requirements.

### Refunds and Statement Descriptors

`createRefund(ctx, { stripePaymentIntentId?, stripeChargeId?, amount?, reason?, refundApplicationFee?, reverseTransfer?, ... })` issues a Stripe refund with marketplace semantics, both defaulting **on**:

- `refundApplicationFee` — return the platform's application fee pro-rata with the refund (destination charges only; Stripe pro-rates partial refunds automatically).
- `reverseTransfer` — pull the refunded amount back from the destination account (destination charges only; also pro-rated for partials).

Stripe hard-errors if either flag is sent for a charge that doesn't carry an application fee / destination transfer, so `createRefund` resolves the charge first and only sends each flag when the charge can honor it. **Split (separate-charges) sales carry neither** — those go through the same charge, so their clawback is webhook-driven: on `refund.created`/`.updated`, `reverseTransfersForRefund` reverses each recipient's ledger leg pro-rata to the cumulative amount of live refunds whose status is `succeeded`. Pending, action-required, failed, and canceled refunds are excluded; `charge.amount_refunded` alone can include pending refunds. Affiliate legs converge on the larger successful-refund or dispute exposure, capped at the original commission, so the same principal is not recovered twice. A separate `application_fee.refunded` handler keeps the linked payment's `feeCollectedAmount`/`feeRefundedAmount` in sync. The `refunds` table and the linked `payments` row update as the corresponding webhooks arrive; `createRefund` itself returns only the new refund id.

Per-store statement descriptors make destination charges recognizable on a buyer's card statement (`PLATFORMPREFIX* SUFFIX`):

```typescript
await stripe.setAccountStatementDescriptor(ctx, {
  stripeAccountId,
  statementDescriptor: "ACME STORE", // or null to clear
});
```

Validated against Stripe's rules (`validateStatementDescriptorSuffix`: 1–22 chars, at least one Latin letter, no `< > \ ' " *`, no non-Latin — rejects rather than truncates) before writing. Resolution order per charge: the store's stored suffix → the platform's configured `statementDescriptorSuffix` default (constructor option) → none. One-time payments set the suffix directly on the PaymentIntent at checkout. Store-owned products carry the descriptor for subscriptions' first charges; the webhook processor sets it on later invoices. Refresh existing products with `updateProduct` after changing a store's descriptor.
