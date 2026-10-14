# Checkout, pricing and affiliate QA evidence

Code: 07b5b5b5d23c961a47e95f50c0610f3c03e9d427.
Branch: codex/checkout-email-and-split-qa. Evidence recorded on 2026-10-14.
All payments used Stripe sandbox; no live charges.

## Verification

- All five checkout integrations tested with real sandbox payments and reconciled Stripe fees/transfers.
- Commission audit: 32 successful payments and four declined attempts. Twenty successes paid an affiliate; twelve correctly paid no commission.
- Percentage inheritance, fixed amounts, explicit zero, invalid/missing referrals, copied store links, and Visitor/Customer attribution verified.
- Declined-card retries produced one successful settlement per payment, without duplicate affiliate transfers.
- Two browser subscription checkouts saved One-time and Forever terms. Two additional test-clock subscriptions paid their initial invoices and renewed through normal Stripe webhooks after advancing 32 days.
- On each $49 renewal, actual processing was $1.72 and platform revenue $2.69. One-time paid affiliate $0 and seller $44.59. Forever paid affiliate $4.45 and seller $40.14. See renewal-results.json.
- API and package component layouts, pagination, admin pricing, and inline payout controls have browser regression coverage.
- React Doctor: 90/100, no issues. Final repository gate results are in repository-gates.log.
- Temporary configuration changes restored. Sandbox transactions/subscriptions remain inspectable.

## Recordings and screenshots

- custom-checkout.webm: successful custom Checkout flow.
- declined-card-retry.webm: declined payment followed by a successful retry.
- affiliate-terms.webm: final readable term controls across seller/API, package components, and admin. Navigation/loading is included; screenshots provide clearer static views.
- PNG files: final admin plans/editor controls and API/component layout/pagination comparisons.

Financial browser recordings were made on their implementation commits before the final documentation-only commit. Commission audit was completed at e82a0f9/6ece1f0; term checkout/renewal and UI checks at b21dde8. The final gate run covers the full PR head.

Jordan's unready onboarding store was correctly excluded from live purchases; Pro fee math has unit coverage. The committed term browser test covers initial checkout and controls, while the renewal evidence came from a separate Stripe test-clock run. An unclaimed One-time subscription with more than 100 paid invoices requires review rather than guessing.

The first final coverage run hit two 5-second React barrel import timeouts. The full suite was rerun without code or timeout changes and passed all 15 gates.
