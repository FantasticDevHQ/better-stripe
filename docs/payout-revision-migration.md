# Payout revision journal migration

BetterStripe can move an account's internal financial and risk revision counters to an append-only journal. This is a storage migration, not a payment, transfer, payout, reconciliation result, or financial coverage certificate. It makes the latest account revision a single indexed read while retaining a separate risk-only read range. Ordinary positive funding does not change that risk range.

Existing accounts keep using the legacy counters until explicitly activated. Financial writes do not silently migrate an account. Activate every destination before an operation that relies on the journal's lower read cost, including new destinations added after an inventory pass. Native read and byte limits still apply. A completed migration does not independently guarantee that an operation fits those limits.

## Trusted host API

Authorize these methods in your server application. Do not expose unrestricted migration endpoints to customers. No Stripe API key or provider request is needed.

```ts
// Smallest primitive, useful when provisioning a new destination.
const result = await betterStripe.payoutRevisionMigration.activateAccount(ctx, {
  accountId: destinationAccountId,
});
// result.status is activated, unchanged, or held.

// A server-owned inventory pass over the existing component data.
let job = await betterStripe.payoutRevisionMigration.begin(ctx, {
  operationKey: "revision-layout-rollout-1",
});
// Schedule each step as a separate durable host mutation.
// Do not execute an unbounded loop inside one Convex transaction.
job = await betterStripe.payoutRevisionMigration.resume(ctx, {
  jobId: job._id,
  expectedStep: job.step,
});
```

Each resume reads at most one inventory row and activates at most one account in the same transaction. The component owns the cursor and inventory phase. A repeated stale step returns the current job without processing another row; a future or invalid step fails. Repeating `begin` with the same operation key returns the existing pass. Use a new key for a new pass.

The inventory covers both legacy revision tables and accounts in transfers, payouts, recovery balances, payout source allocations, payout release claims, and payout fee balances. Per-pass account digests prevent duplicate counts. Result rows retain the source table and original document ID. They include the account key only when it fits within 256 UTF-8 bytes; larger keys remain in their original source record rather than being duplicated into a potentially oversized diagnostic row. `get` reads the job; `results` pages account outcomes with normal Convex pagination options, bounded to 100 rows and a private byte budget.

A finished pass only means its server-owned cursors exhausted the inventory they saw. Records can be added during or after a pass. Re-run inventory and explicitly activate new destinations as part of provisioning. A finished pass and an exhausted results page grant no payout eligibility, closure, attempt admission, or complete financial history.

## Held accounts and compatibility

Activation preserves the exact legacy row IDs, timestamps, counters, and source records. It inserts a baseline without incrementing counters or creating risk events. Financial-only, risk-only, absent, signed, and safe maximum counters retain their existing reader semantics. Existing financial callbacks append actual bumps and continue to write the same risk events. The old counters become frozen historical evidence for activated accounts.

Duplicate legacy authorities, disagreeing counters, unsafe numeric values, and representations that cannot safely fit a baseline return `held`. Such accounts remain on the existing path. The migration does not repair, normalize, merge, or discard those records. Malformed canonical journal authority aborts the step atomically instead of returning `held`. Inspect outcomes and arrange a separate reviewed repair; do not count held accounts as activated. Re-run a new pass after a repair.

An old SDK calling a newly deployed component is different from deploying old component writer code. After activation, the legacy counters are no longer current. **Do not roll component code back to legacy-only writers without a separately reviewed restore migration.** Deploying old writers directly would resume from stale counters.

## Verification boundary

The journal's large-operation capacity must be verified on a native Convex backend with the actual callbacks enabled. JavaScript database mocks do not prove native read limits or OCC behavior. Same-database claim, replay, release, rollback, risk-range isolation, and concurrent activation/source writes are required before claiming the capacity issue fixed. No application deployment is migrated by installing the package.

## Native regression results

The isolated native regression retained the same SQLite database and 1,000 original transfers across published 0.50.1 and the candidate. The published claim failed the 4,096-read limit with full rollback. After explicit activation of all destinations, claim, matching replay and release succeeded with every original slice and per-currency earnings preserved. Original row IDs, frozen legacy counters and transfer observations remained intact. Claim wrote exactly 1,000 risk events; releasing unused claims advanced financial counters again while preserving risk revision 1.

Release used 4,077 of 4,096 reads in that fixture. This narrow margin is evidence for the tested shape, not a promise that arbitrary near-limit documents or extra host work fit. Run large financial operations in dedicated transactions. Do not increase limits, skip callbacks, truncate recipients or count held destinations as activated. The admitted claim limit remains 1,000 transfers. A historical imported operation with 1,001 positive slices also released successfully; its missing original diagnostic provenance remained held and unknown.

Native controls also verified 250/500/750 distinct destinations, 1,000 legs sharing four destinations, a complete 8,711-step inventory pass with stale-step replay and paginated outcomes, and actual OCC retries. Ordinary positive funding left the risk-only read range stable. A real risk change retried the reader; activation racing a source write retried against the changed legacy counter. These are local backend checks with synthetic data and zero Stripe requests. They do not replace application authorization, deployment-specific capacity testing or independent release acceptance.
