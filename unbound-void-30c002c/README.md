# Unbound void invoice recovery

Source: 30c002c49a259a1470d53e652d6cb566fdaf1374.

The public CostRecoveryClient was tested against a real Stripe sandbox invoice and deployed Convex component. No payment was attempted. The invoice remained open without a recovery item: $3.20 stayed reserved. After Stripe verified it was void, reconciliation released that reservation exactly once; retries created no recovery item or collection. The synthetic QA claim was then zeroed. The source claim economics were synthetic, not an actual customer refund.

The 16 focused regression tests also cover complete pagination, interrupted scans, owner/currency mismatches, missing bound items, and unresolved outcomes. gates.log records the full repository checks on the rebased source. No UI changed; backend evidence is supplied instead of a screen recording.

This fixes one invoice lifecycle edge case. It does not claim the example recovery cutover or combined renewal acceptance is complete.
