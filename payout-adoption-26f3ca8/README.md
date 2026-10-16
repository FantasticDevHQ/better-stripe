# Public historical-adoption evidence

Financial implementation tested: `26f3ca8e8e622f40979c53469516295f9b7d1008`. Current branch also includes documentation corrections and the merged 0.29.0 release metadata at `48d6f3c`; financial code is unchanged.

All 15 repository gates pass in a clean checkout, 77.7% line coverage. Twelve new adoption tests and nineteen reconciliation tests pass under coverage. The existing 64 adoption/policy tests passed before the final performance changes; the full final gates include those tests again. No existing gate floors, size limits or timeouts were raised. Four new multi-pass scenarios were assigned 15 seconds before the first full gate run.

The initial gate run failed on new-test timeouts. Covered activation took 21.1 seconds. The implementation reuses its verified read-only collection, avoids no-op verified-fee writes, and retains every allocated source proof per new historical claim without duplicating unrelated source evidence. Complete batch membership is still checked atomically. Existing claims are unchanged. Covered activation now takes 5.8 seconds; all final gates pass. RED and intermediate failure logs are retained here with their scope explicit, including cutoff, stale-proof, cleanup and performance failures.

A fresh isolated Stripe sandbox recipient is being populated with 205 actual transfers and 101 actual prior bank payouts. The next test will use public `adoptPayouts`, funded `prepare`/`apply`, and the scheduled worker. No private mutation will import historical claims or allocations. Live receipts, video and cleanup evidence are still pending and will be posted before merge. This document does not yet claim the live adoption scenario passed.
