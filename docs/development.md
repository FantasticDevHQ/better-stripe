# Development guide

### Development toolchain

Use Node.js 24, as CI does, and the pinned pnpm version in `package.json`.
The package supports Node.js 20+, but the Vite example requires Node.js 22.12+.
From the repository root, run `pnpm install --frozen-lockfile` and
`pnpm run build:clean`. After configuring the example's existing Convex development
deployment, `pnpm dev` starts its backend watcher and Vite frontend. Use the
localhost URL Vite prints, normally http://localhost:5173. For a frontend-only
server against an already deployed backend, run `pnpm run dev:frontend` from
`example/`. See
[the example setup guide](https://github.com/FantasticDevHQ/better-stripe/blob/main/example/README.md).

The BetterStripe example separates visitor, customer, affiliate, seller, and
platform-admin workflows. Fresh fictional Maya and Sasha stores explicitly
configure 20% Forever referral commissions to fund the affiliate payout example;
ordinary stores still default to zero, and seed reruns preserve later edits.
Its resumable Stripe sandbox fixtures populate sales,
referrals, refunds, disputes, subscriptions, and payouts. Seller plans include
monthly billing, actual Stripe fee reconciliation, and refund/dispute cost
recovery. The example also demonstrates optional balance-funded subscriptions
using Stripe's Accounts v2 preview. See the setup guide for consent requirements,
renewal tests, and payment-recovery limitations.

The example compares via API views, BetterStripe React components, Stripe Connect
embeds, and hosted billing where supported. Its checkout chooser demonstrates
Hosted Checkout, Embedded Checkout, custom Checkout Sessions with Payment Element,
Payment Intents with Payment Element, and the preview Embedded Checkout Form,
with pros and cons for each. `createCheckoutSession` accepts `uiMode` values
`"redirect"`, `"embedded"`, `"custom"`, and `"form"`; the latter two map to Stripe's
`elements` and preview `form` modes. See [the integration examples](https://github.com/FantasticDevHQ/better-stripe/blob/main/example/README.md#compare-integration-styles).

Admins can configure store-plan monthly prices and sale fees. Monthly price changes
create new Stripe Prices; existing store subscriptions keep their current price.
Affiliate payouts accept percentages or fixed amounts in the sale currency, with
optional price, product, store, plan, and platform defaults. Unconfigured payouts
are zero. Subscription commission terms are **Forever** or **One-time**, with
Forever as the default. The example saves the selected term in Stripe subscription
metadata and its Convex ledger, then applies it when paid invoices settle.
See [affiliate configuration and testing](https://github.com/FantasticDevHQ/better-stripe/blob/main/example/README.md#seller-product-and-subscription-affiliate-payouts).

The public React exports include `AffiliatePayoutEditor`, `PlanPricingEditor`,
`Pagination`, and `useCursorPagination`. The example supplies styling through
render props; its backend owns authorization and rule inheritance. The package owns durable
transfer execution, retained financial records and provider reconciliation.
See [the workflow reference](react-workflows.md#percentage-or-fixed-affiliate-payouts)
and [the UI reuse audit](react-workflows-audit.md).

Run `pnpm run check:all` before submitting changes. It runs the build, lint,
formatting, typechecks, codegen drift check, tests, and repository quality gates
used by CI. Policy lives in `repo-gates.config.json`; measured baselines live in
`gates/`. Fix failures without weakening the gates or raising existing budgets.

Coverage checks enforce the committed floors in `gates/coverage-budgets.json`.
`pnpm run check:coverage` and `pnpm run check:all` never edit that file or fail
because coverage improved. Ordinary feature PRs should leave the budget file alone.

The [weekly coverage workflow](https://github.com/FantasticDevHQ/better-stripe/actions/workflows/coverage-ratchet.yml)
runs Mondays at 09:17 Asia/Bangkok, 02:17 UTC. It runs every repository gate on
`main`, then captures earned floor increases of at least **0.05 percentage points**
per metric. It keeps the existing 0.5-point margin below measured coverage and
never lowers a floor. Eligible metrics capture their full earned increase; this
is a minimum useful change, not a forced weekly increase. Smaller gains accumulate
until a later run. Failed checks and old reports cannot authorize any update.

The workflow maintains one ready-for-review PR on `codex/coverage-ratchet`, changing
only the coverage budget file. Its description records measured coverage, old and
proposed floors, and a link to the full gate run. It reuses the existing release
GitHub App configuration so the generated PR runs normal CI. Auto-merge matches
the exact generated head and waits for all required checks under the existing
branch protections, without bypass actors. The helper checks the app author,
branch, repository, changed files, policy metadata, and measured proposal before
enabling auto-merge. Do not add unrelated commits to this managed branch.

Use **Run workflow** on `main` for an additional full measurement between weekly
runs. Once merged, this workflow becomes available to the scheduler and manual
dispatch. Locally, `node scripts/check-coverage.mjs --ratchet` runs the same complete
gates before proposing a budget update. It accepts no test filters, partial mode,
or skipped execution. `pnpm test:coverage` generates a report only.

Builds and typechecks use TypeScript 7 (`@typescript/native` aliases
`typescript`). ESLint and Convex code generation still need the TypeScript 6
API, so `typescript` aliases Microsoft's `@typescript/typescript6` compatibility
package. Keep both aliases when updating dependencies, as described in
[Microsoft's migration guide](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0).

Stripe 23 targets API version `2026-09-30.endive`. Account links now collect
requirements without a `configurations` parameter; callers can still pass the
legacy option, but it is not sent to Stripe. See the
[Stripe API changelog](https://docs.stripe.com/changelog) before upgrading an
existing integration to this API version.

### Regenerating codegen

The component ships committed Convex codegen output at `src/component/_generated/{api,component,dataModel,server}.ts` — consumers reach the bindings via the `./_generated/component` subpath export. The example app also commits its own codegen at `example/convex/_generated/`. Running `pnpm dev` (which wraps `convex dev`) regenerates these automatically when the schema or function definitions change, but only against the live dev deployment and only while the dev server is watching.

The example resolves the workspace package through `dist/`. After changing
component source, regenerate library bindings with `pnpm codegen:lib`, run
`pnpm build`, then deploy the rebuilt component from the example directory with
`pnpm exec convex dev --once`. Run `pnpm codegen:example` afterward. Code generation
alone does not prove that a newly added function is mounted; invoke a representative
query or action against the development deployment before running financial tests.

If you add, remove, or rename a query/mutation/action on a branch without the dev server watching — or after a rebase — regenerate explicitly before committing:

```bash
pnpm codegen            # regen the library component + example app
pnpm codegen:lib        # regen src/component/_generated only
pnpm codegen:example    # regen example/convex/_generated only
```

All three require a configured dev deployment, normally selected by a prior
`pnpm exec convex dev` from `example/`. They generate local bindings and, for
components, upload and analyze definitions against the selected development
deployment. Codegen does not replace its serving application or run a data
migration; deploying updated handlers still requires `convex dev` or
`convex dev --once` from `example/`. Keep secrets and deployment-key overrides
out of the wrong terminal. See [safe development selection](metering-setup.md#run-the-repository-example).

**CI gate.** Two layers verify the committed files are not stale:

1. **Structural drift check** (`pnpm codegen:check`, always runs in CI): two independent scans, each checking both directions (every source export appears in the generated file, and every generated entry still has a matching source), neither needing a deployment:
   - Library component — scans `src/component/**/*.{queries,mutations,actions}.ts` and verifies every exported function appears in `src/component/_generated/component.ts`. The reverse direction also flags a stale entry left behind by a _deleted_ query/mutation/action. The export-detection regex intentionally matches only direct `query(...)`/`mutation(...)`/`action(...)` exports — not wrapper or re-export forms like `customQuery(...)` (convex-helpers) or `export { fn as name }`, which this component has none of today; widen the regex (and the reverse scan) rather than assuming that stays true.
   - Example app — scans `example/convex/**/*.ts` and verifies every source module is imported and registered in `example/convex/_generated/api.ts`. Catches the common case of adding a new `example/convex/<module>.ts` (or nested file like `example/convex/lib/<module>.ts`) without regenerating. The reverse direction likewise flags a stale import left behind by a _deleted_ module.
2. **Authoritative regen-and-diff** (runs in CI when `CONVEX_DEPLOYMENT` is configured): runs `pnpm codegen` against the configured dev deployment and fails if `git diff` shows changes. Catches every drift case, including validator-shape changes the structural check can't see. To enable on a fork, set the `CONVEX_DEPLOYMENT` repo secret to a dev deployment name and authorize the CI runner — see Convex's [GitHub Actions guide](https://docs.convex.dev/production/integration/deployments#github-actions).
