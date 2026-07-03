---
"@getdojo/better-stripe": minor
---

Reclaim/expiry of dead reversal claims (BTS-74).

BTS-63 reserves reversal slices atomically before money moves; the executor now refuses to leapfrog an unexecuted predecessor claim. The residual, by-design failure mode: if the operation that reserved a slice dies permanently (its webhook exhausts Stripe's retries and never confirms), the claim frontier stays ahead of the confirmed `reversedAmount` forever, and every successor reversal on that leg blocks with `predecessor claim unexecuted`. This adds an ops path to resolve such wedged legs.

- **`BetterStripe.listWedgedReversalClaims(ctx)`** — lists legs where `reversalClaimedAmount > reversedAmount` and the recorded ops holding the blocking (unexecuted) slice on each. An ops/admin diagnostic; scans the ledger to completion (exact, and loud past Convex's 16,384-doc read limit rather than silently truncating).
- **`BetterStripe.reclaimReversalClaim(ctx, { operationId, mode })`** — resolves a dead claim:
  - `mode: "reexecute"` (default, always safe): replays the op's recorded slices under the original `bs_rev_<opId>_<transferId>` idempotency keys, moving any money that never moved and recording any that moved-but-wasn't-confirmed. Fills the hole so blocked successors proceed; cannot double-reverse.
  - `mode: "release"`: abandons the claim (rewinds each leg's frontier to the pre-claim amount and deletes the op record). Gated on BOTH the op being older than `minAgeMs` (default ~24h, past Stripe's idempotency-key window) AND live Stripe `amount_reversed ≤ slice.from` on every leg; the component mutation additionally refuses if a successor already claimed past the slice (re-execute instead).

New component functions: `connect/queries/listWedgedReversalClaims`, `connect/queries/getReversalOp`, `connect/mutations/releaseReversalClaim`. No behavior change to existing reversal paths.
