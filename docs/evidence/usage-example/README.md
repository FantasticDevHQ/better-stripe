# Native usage example evidence

Recorded on 2026-10-18 against the existing BetterStripe Stripe sandbox and
Convex development deployment. The example runs at `/demo/metered-usage`.
All customers, work and card payments in this evidence are synthetic test data.
No live billing, production migration, Metronome enrollment or new secret was used.

[Watch the live browser recording](native-flows.mp4). It is a continuous
19.33-second capture of the in-app browser at 1280 × 720, sampled at about 4.5
frames per second and encoded with original elapsed timing. It switches between
all three models and shows their native paid invoices, original cash and verified
seller/affiliate settlement. It records existing completed runs rather than
repeating a card payment for the camera. Selectable captions and
[video assertions](video-annotations.json) identify each model. It contains no
mocked provider data, generated UI or desktop content outside the example tab.

The additional PNGs show the earlier pending-payment, held-work, replay,
exhaustion, correction/history, unsupported-recipient and archive/reset states.
[Capture assertions](annotations.json) retain their capture times. Files ending
in `full.png`, plus the first three model overview images, contain the complete
page so the surrounding configuration and history can be inspected.

## Observed outcomes

[Sanitized native API output](native-results.json) records complete original
bindings, paid invoice observations, verified payment provenance, actual fees,
retained summaries and cleanup results. Values below are USD minor units.

| Flow                                   |       Effective units | Invoice cash | Original cash source | Processing fee | Verified transfers                |
| -------------------------------------- | --------------------: | -----------: | -------------------: | -------------: | --------------------------------- |
| Direct issuer pay as you go            |                    15 |         1500 |         Invoice 1500 |             74 | None                              |
| Direct issuer included monthly usage   | 15, including 10 free |          500 |          Invoice 500 |             45 | None                              |
| Direct issuer prepaid                  |                    10 |            0 |        Purchase 1000 |             59 | None                              |
| Eligible seller pay as you go          |                    15 |         1500 |         Invoice 1500 |             74 | Seller 1080, affiliate 270        |
| Eligible seller included monthly usage | 15, including 10 free |          500 |          Invoice 500 |             45 | Seller 360, affiliate 90          |
| Issuer prepaid with affiliate          |                    10 |            0 |        Purchase 1000 |             59 | Affiliate 180; issuer retains 761 |

The direct issuer runs each canceled an original five-unit event and accepted a
different five-unit job. History retains the original acceptance and cancellation;
effective native totals remain 15/15/10. Replaying accepted application work did
not add units or repeat application work. The included flow reached the soft
threshold and billed only five overage units. Prepaid work was held before
payment, pending purchase granted no units, verified capture granted ten units,
and exhaustion denied further work without another payment.

The eligible seller's original paid invoice settlement was resumed and retained
the same native transfer IDs. The unonboarded seller's prepaid path also succeeded
with issuer-service credits and the authorized affiliate, without paying the
seller. Its ordinary seller invoice paths correctly retained unresolved transfer
outcomes because the original seller lacks native transfer capabilities.

All seven successful customer/seller runs were archived through the scoped
cleanup action. It closed credit accounts only after fresh complete native backing
proof, canceled owned subscriptions at period end, verified final native invoices,
retired enrollment and deactivated owned prices/meters/products. Payers, clocks,
payment evidence and component history were retained. Archived configuration is
editable for a new isolated run.

## Verification and limits

- `pnpm run check:all`: all 15 gates passed in 299.2 seconds, including full tests,
  coverage, generated API checks, design-system rules, size/debt/cycle/secret
  checks and CI parity. Coverage was 82.3% lines, above the unchanged floor.
- Focused package/example suite: 158 tests across 22 files passed. Subsequent
  focused navigation, settlement observation and UI tests also passed; the full
  gate suite includes the final versions.
- React Doctor: 93/100, no errors or correctness warnings. One maintainability
  warning identifies the example workflow's control-flow complexity.
- Shadscan: 100/100. No floor, budget, gate policy or baseline was relaxed.
- Native future renewal periods were observed. Convex retains its real wall-clock
  allowance guard, so future renewal allowance is unavailable in this sandbox.
  Monthly counter reset and retained old-period accounting are separately verified
  with the existing controlled-clock component test in
  `src/component/usage/allowance.test.ts`.
- Earlier ambiguous native deliveries remain held. Stripe rejected events outside
  an attached test clock's future window without a machine-readable error code.
  Their identities and financial operations were preserved; cleanup refused to
  advance their clocks. New synthetic work uses its retained logical fixture
  clock, and package delivery now checks an attached native test clock before
  writing. Real applications must use their actual business occurrence time.
- Expected unsupported-recipient outcomes remain unresolved. They were not
  relabeled as successful, refunded, deleted or transferred to another seller.
- Native sandbox evidence does not establish live-money readiness, production
  recipient eligibility, sustained throughput or an actual real-time monthly wait.

The PR evidence comment identifies the exact reviewed head and current CI results.
