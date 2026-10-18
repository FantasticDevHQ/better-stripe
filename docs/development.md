# Development guide

### Development toolchain

Install with `pnpm install` from the repository root, then run `pnpm build`
and `pnpm dev` to start the example at http://localhost:5173. The example needs
Node.js 22.12+ and a configured Convex development deployment; see
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
render props; its backend owns authorization, rule inheritance, and transfers.
See [the workflow reference](react-workflows.md#percentage-or-fixed-affiliate-payouts)
and [the UI reuse audit](react-workflows-audit.md).

Run `pnpm run check:all` before submitting changes. It runs the build, lint,
formatting, typechecks, codegen drift check, tests, and repository quality gates
used by CI. Policy lives in `repo-gates.config.json`; measured baselines live in
`gates/`. Fix failures without weakening the gates or raising existing budgets.

Successful full coverage checks automatically raise the floors in
`gates/coverage-budgets.json`. Run `pnpm run check:coverage` or
`pnpm run check:all`, then commit any budget changes. Each metric retains the
existing 0.5 percentage point margin below its measured baseline, and floors
never decrease. Failed checks leave the budgets untouched. CI checks the same
ratchet and fails if an improvement has not been committed. `pnpm test:coverage`
only generates the report; filtered or skipped runs cannot update floors through
the automatic ratchet.

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

All three require a configured dev deployment (`CONVEX_DEPLOYMENT` env var, normally set by a prior `npx convex dev`). They write only the local `_generated/` files — they don't push code or data to the deployment.

**CI gate.** Two layers verify the committed files are not stale:

1. **Structural drift check** (`pnpm codegen:check`, always runs in CI): two independent scans, each checking both directions (every source export appears in the generated file, and every generated entry still has a matching source), neither needing a deployment:
   - Library component — scans `src/component/**/*.{queries,mutations,actions}.ts` and verifies every exported function appears in `src/component/_generated/component.ts`. The reverse direction also flags a stale entry left behind by a _deleted_ query/mutation/action. The export-detection regex intentionally matches only direct `query(...)`/`mutation(...)`/`action(...)` exports — not wrapper or re-export forms like `customQuery(...)` (convex-helpers) or `export { fn as name }`, which this component has none of today; widen the regex (and the reverse scan) rather than assuming that stays true.
   - Example app — scans `example/convex/**/*.ts` and verifies every source module is imported and registered in `example/convex/_generated/api.ts`. Catches the common case of adding a new `example/convex/<module>.ts` (or nested file like `example/convex/lib/<module>.ts`) without regenerating. The reverse direction likewise flags a stale import left behind by a _deleted_ module.
2. **Authoritative regen-and-diff** (runs in CI when `CONVEX_DEPLOYMENT` is configured): runs `pnpm codegen` against the configured dev deployment and fails if `git diff` shows changes. Catches every drift case, including validator-shape changes the structural check can't see. To enable on a fork, set the `CONVEX_DEPLOYMENT` repo secret to a dev deployment name and authorize the CI runner — see Convex's [GitHub Actions guide](https://docs.convex.dev/production/integration/deployments#github-actions).
