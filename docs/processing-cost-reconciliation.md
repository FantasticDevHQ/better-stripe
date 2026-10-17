# Processing-cost reconciliation

`betterStripe.costRecovery.startProcessingCostReconciliation` observes provider costs and records a revised deficit in the existing recovery ledger. It never collects money itself. A host supplies authorization, an internal provider action, an explicit deficit policy, and optional internal import/projection mutations. Use `startRecoveryWorkflow` separately to collect the resulting ledger balance.

The immutable request binds account, scope, currency, claim key, original payment and gross, expected claim revision, policy, provider/API definition version, callback handles, and retry bounds. Reusing a request key with a changed binding returns `identity_changed`. A scoped payment retains one claim key. Original selling fee and verified provenance cannot change after the first completed observation. A changed authoritative claim revision returns `revision_changed`; a new host decision must use a new request and the newly read revision. Resume never refreshes it implicitly.

## Provider action boundary

The host's internal action receives only the scoped operation reference and pinned versions. Call `betterStripe.costRecovery.observeProcessingCosts(ctx, request, { stripeSecretKey })` inside that action. Resolve credentials there; never put them in operation arguments, callback payloads, or Workflow state. The adapter creates a fresh Stripe client pinned to the saved API version, disables SDK network retries, and only issues GET requests. The component bridge validates a closed receipt before Workflow journals it. Provider bodies, metadata, credentials, and exception text are excluded.

Sale mode verifies the original invoice payment and historical price/product using the payment-source resolver. It does not infer provenance from metadata or a current subscription item. Explicit `invoice_recovery` mode requires a matching collected invoice recovery group and rollback group. It verifies the bound invoice item, the full invoice amount, one complete forward and inverse funding relationship, the original charge, and its fee. This mode carries invoice/item/funding provenance and does not invent a price or product.

Provider histories are limited to five pages and 500 items per collection. Repeated IDs, malformed pages, exhausted budgets, incomplete histories, partial funding, and ambiguous funding fail closed. Unknown and unavailable observations never write zero costs. Known `not_ready` outcomes retry up to `maxAttempts` (1–20); unknown outcomes stop for explicit host resume. Resume performs read-only observation again, using the same binding and revision guards.

## Atomic adoption, rollback, and projections

Use `expectedRevision: -1` for an absent live claim. An optional import hook runs only when that claim is absent, after identity and revision checks. The host verifies its historical record and returns either `null` or an opening snapshot containing an immutable `operationKey`, `amountDue`, `collectedAmount`, and `revision`. The component imports through the existing opening-claim ledger and advances that revision once. A host migration marker written by the hook shares the transaction; hook or projection failure rolls back both host and component changes.

An optional rollback binds a collected original recovery group and its own `expectedRevision`. Its revision guard is independent of the main claim. The original group's funding identity and economics must match the observed payment before any import, claim, rollback, or funding-binding write. Refund/dispute principal adjusts the existing rollback claim. A later won dispute can reduce an already collected rollback obligation into a ledger credit without collecting or releasing funds again.

The projection callback is a database-only internal mutation invoked with the completed scoped result. It shares the transaction with both claim updates and completion. A failed projection leaves all changes unapplied. Resume restarts the failed apply step using its saved provider observation, without reading the provider again. Completed operation replay returns its original result even after newer operations have advanced the ledger; it never rewrites that newer state.

Host store eligibility, liability policy, economic allocation, reports, and migration cutover remain host decisions. The component stores generic operation metadata and uses existing claims, opening imports, balances, and rollback reservations for financial accounting.
