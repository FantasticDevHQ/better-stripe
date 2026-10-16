# Public historical-adoption evidence

Final PR code and all 15 clean-checkout gates: `503609388c537b60666da760b5a1958842befd19`. Coverage is 77.7% lines. No existing gate floors, size limits or timeouts were raised. Four new multi-pass scenarios were assigned 15 seconds before the first full gate run.

## Real Stripe sandbox

An isolated, owned sandbox recipient received 205 actual transfers totaling 10,250 cents, alternating store and affiliate funding. It had 101 actual prior bank payouts of 100 cents each. Public `adoptPayouts` imported the historical claims and allocations. No private mutation imported financial claims or allocations. An extra read-only QA query inspected counts; actor-allowlisted internal actions called the public SDK. Transfers are fixture funding, not a claim of customer-checkout coverage.

Public adoption passed in 162.1 seconds, funded preparation in 254.3 seconds, and apply in 251.4 seconds. The original weekly schedule remained until apply. Preparation retained the actual oldest unpaid source age. The production recurring worker paid exactly the remaining 150 cents once, yielding 102 paid payouts totaling 10,250 cents. All 205 source allocations reconcile, with zero available/pending/reserved funds and no disposable proof cache. A replay dispatch produced no duplicate payout.

The full financial scenario ran at `48d6f3c`, whose financial implementation matches `26f3ca8`. Final-code `5036093` was then deployed to the same isolated backend. Replaying public apply returned ready; the subsequent production worker check reported below_threshold with no active operation. Cleanup restored the original weekly schedule and closed the owned recipient after verifying zero funds and no in-flight bank payouts. See `sandbox-public-adoption.json` for exact results.

The video is a continuous final 180-second excerpt of the native browser recording, omitting the long setup and provider-read waits. It shows the real example UI and annotation overlays. Screenshots include the zero balance, paid accounting split and final bank payout. The UI assessment can show a worker state sampled at the start of its long provider scan; the later API evidence establishes the completed below-threshold outcome. No Stripe embedded-component checkout claim is made by this backend-adoption evidence.

## Regression and performance checks

The initial gate run failed on new-test timeouts. Covered activation took 21.1 seconds. Reusing the verified read-only collection, avoiding no-op fee writes, and retaining each claim's allocated source proofs brought covered activation to 5.8 seconds. Complete batch membership is still checked atomically; existing claims are unchanged.

A deterministic concurrent-activation test then reproduced a duplicate caller rejecting after the first caller removed their shared proof cache. The final fix rechecks the same durable operation and resumes its canonical completed/attempted path. Unattempted proof failures still reject; the test verifies a single payout. Both concurrency tests and twelve large-history cases pass. Final full gates pass on the exact PR head. RED, intermediate failure and final PASS logs are retained with their scope explicit.
