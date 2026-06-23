---
"@getdojo/better-stripe": minor
---

Expand the subscription write surface with five new `BetterStripe` methods, all routing through the component's webhook-sync path (`customer.subscription.updated` → `subscriptionUpserted`) and returning `{ success: true }`:

- `pauseSubscription` — sets `pause_collection` (defaults `behavior: "keep_as_draft"`, optional `resumesAt`).
- `resumeSubscription` — clears `pause_collection` via the empty-string sentinel.
- `updateSubscriptionPrice` — swaps the first item's price; defaults `prorationBehavior: "none"` (no proration line items), caller-overridable.
- `updateSubscriptionMetadata` — merges/upserts metadata keys (existing keys not included are preserved).
- `updateSubscriptionTrialEnd` — extends or ends a trial (`"now"` or a Unix timestamp).

Also: the existing `cancelSubscription`, `reactivateSubscription`, and `updateSubscriptionQuantity` now wrap their Stripe SDK calls in `throwStripeError`, so failures surface as a structured `ConvexError<BetterStripeError>` (`STRIPE_API_ERROR`) instead of a raw `Error`.
