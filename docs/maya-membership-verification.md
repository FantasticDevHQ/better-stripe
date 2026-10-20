# Verify Maya's membership end to end

Maya's Fitness Coaching Membership costs USD 20 per month, includes 60 whole
coaching minutes, and charges USD 1 per extra minute. Both **via API** and
**BetterStripe components** use the same enrollment and authorized coaching
operation. The tabs change usage/history rendering, not the purchased product.

## UI check

Start the [example](metering-setup.md) and open `/demo/metered-usage` as Customer.
Review Maya's original membership. Complete Checkout in Stripe test mode if it
has not already been paid, then refresh enrollment. Check both integration tabs
before and after completing coaching work. Switching tabs must retain the same
subscription and history without adding usage. Refresh usage/history after
provider delivery, then preview the next invoice.

On 2026-10-20, Alex's existing membership initially had one 75-minute session.
Both tabs showed 60 included, zero remaining and 15 overage minutes. Stripe's
native preview was USD 35, including USD 15 usage. One additional minute was
submitted with via API selected, then one with BetterStripe components selected.
Both completed once. Each view subsequently showed three sessions, 77 minutes
and 17 overage minutes. These extra test minutes remain in Alex's history.

Delivery and native aggregation are separate asynchronous steps. During this
check, Stripe first showed 60 native minutes while the local ledger had already
accepted and delivered 75. The native preview later reached USD 35. Do not
advance a renewal until the original native invoice preview includes all intended
usage. A draft preview is an estimate, not captured cash or transfer authority.
Partial-minute Checkout periods may not support an exact meter-summary read;
use the invoice preview without rounding the original period.

## Isolated renewal using the same product

Do not advance Alex's shared clock or replace his payer. The internal developer
fixture `meteredProducts/membershipProof` creates a hidden test buyer with its own
Accounts v2 account and clock, then calls the ordinary product Checkout against
Maya's existing offer. It creates no replacement product, pricing or usage ledger.
It rejects ordinary customers as fixture buyers and future clock start times.
Only run it on the example development deployment with a Stripe test key.

Run Convex commands from `example/`. Query `meteredProducts/catalog:list` with
Maya's actor ID to find her existing offer. Use the saved `ownerId` and offer
`_id`, not a price or account supplied by a browser. Prepare with:

```text
meteredProducts/membershipProof:prepare
{ "runId": "mixed-proof-maya-<unique-name>", "start": <current Unix seconds rounded down to a minute>, "ownerId": "<Maya user ID>", "offerId": "<original offer ID>" }
```

Save these exact arguments for retries, especially `start`. The response contains
`actorId`, `enrollmentId`, `clockId` and the original Checkout URL. Keep that URL
out of committed evidence. Open it and pay with Stripe's synthetic 4242 test card.
The return page retains the browser's existing demo persona; this hidden buyer
is exercised through the ordinary backend functions below.

Call `membershipProof:inspect` with `runId`, `actorId`, `enrollmentId`, `clockId`.
It verifies fixture ownership and clock provenance before reconciling the
completed Checkout, and returns the original fixture JSON used for native reads.
Use `meteredProducts/work:consume` with the returned buyer and enrollment:

1. Submit `requestId: "included-60", quantity: "60"`. Read
   `meteredProducts/readers:snapshot`: consumed 60, included 60, remaining zero,
   overage zero. The next invoice preview must remain USD 20.
2. Submit `requestId: "overage-15", quantity: "15"`. Retry the identical request.
   The retry must report `already_completed` with the same receipt. The snapshot
   must show two sessions, 75 consumed, 15 overage and USD 15 estimated usage.
3. Wait for delivery and native aggregation. Use `readers:preview` until the
   complete original preview shows USD 35 and USD 15 metered usage. Do not infer
   aggregation from the delivery receipt alone.
4. Call `meteredProducts/mixedProof:run` with the saved `fixtureJson` and
   `phase: "audit"` to read the initial payment, actual fee and automatic transfer.
   Then use `phase: "advance"` to advance only the validated fixture clock.
   Poll `phase: "inspect"` until the clock is ready. The renewal contains 60
   included minutes at zero, 15 overage minutes at USD 15, and USD 20 for the next
   monthly period. Automatic collection must pay USD 35.
5. Audit again with that original renewal `invoiceId`. The ordinary billing
   webhooks must have created the seller transfer. Do not call the fixture's
   manual `settle` phase when claiming automatic settlement. Replay
   `billing/events/actions:process` with `type: "invoice.paid"` and that invoice
   ID, then audit again. The transfer ID and transfer count must stay unchanged.
6. Call `membershipProof:cleanup` with the four original fixture identifiers.
   It expires an unpaid fixture Checkout or cancels future fixture renewal while
   retaining financial history. It does not archive Maya's shared product.

The [native evidence](evidence/native-metering/maya-membership-2026-10-20.json)
records this check's original resources. Initial USD 20 split into USD 0.88 actual
processing fee, USD 0.92 platform share and USD 18.20 seller transfer. Renewal
USD 35 split into USD 1.32 fee, USD 1.83 platform share and USD 31.85 seller transfer.
These are observed test-mode fees, not a fee schedule to hardcode.

The renewal uses a future test-clock period. This check does not claim that the
real server accepts work before that future period begins. See the controlled
clock tests and [documented limits](usage-verification.md#tested-limits).
UI evidence consists of sequenced screenshots; the browser-control interface did
not expose continuous screen recording. Native receipts prove billing and
transfers separately from those screenshots. No live billing or production
migration is part of this exercise.
