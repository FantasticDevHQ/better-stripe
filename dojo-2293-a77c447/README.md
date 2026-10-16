# Automatic recipient payout worker verification

Dojo source head `a77c447a3`, including the latest main checkout-flow delivery. Ticket DOJO-2293.

The initial implementation passed all 12 repository gates in 327.5 seconds on pinned Node 24.19.0. Backend 4,695 passed, one existing skip; frontend 7,742 passed, four existing skips; UI 32 passed. All 27 focused worker regressions passed. Final combined-branch gates and CI are running before merge; this report will be updated with their results.

The tests execute actual internal scheduled actions and the installed BetterStripe 0.30.0 worker/policy APIs against real in-memory Dojo, BetterAuth and component schemas. Provider HTTP transport is synthetic. The provider fixture supplies receipts; the package makes qualification, claim, lease and recovery decisions. No financial service or parallel ledger was introduced in Dojo.

Covered behavior: combined creator and affiliate 999/1,000/1,100 threshold boundaries; independent refund/dispute costs and their atomic liability revision; duplicate dispatch with one payout; recovery after a lost debit response and custom-policy opt-out without another create; stored changing-operation identity; original schedule restoration; empty/nonempty holding expiry; retained disabled-login ownership; missing/foreign/org owner rejection; recipient isolation; five-record cursor continuation; provider-managed default as an empty maintenance queue.

The canonical cost scope is `dojo:recipient:<ownerKey>` per account and settlement currency. Source completeness, historical migration, consent, live financial settlement, bank delivery and production deployment are not established by synthetic tests. DOJO-2214 and parent DOJO-2249/2250 retain the outstanding financial adoption and activation requirements. The old mixed anonymous database was not used.

The red logs show the missing owner/quote functions, worker entry points and cron before implementation. Native code generation passes against the explicitly configured Dojo cloud development target. No gate policy, budget or floor was weakened.
