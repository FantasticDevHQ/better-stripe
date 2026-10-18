# Reusable metered billing UI

Import the metered views from `@fantastic.dev/better-stripe/react`. They use the
package's native usage observations and component accounting for all three models:
pay as you go, included monthly usage with overages, and prepaid credits.

The defaults are unstyled semantic HTML. Each view supports render props and a
`className`; stable `data-better-stripe` attributes identify its root. No Stripe
embedded metering component or browser provider credential is required.

## One workflow, either host transport

`UsageBilling` and `useUsageBilling` accept an authenticated asynchronous loader.
The same loader contract works with a Convex query/action client or an HTTP API.
`UsageSummary`, `UsageAllowance` and `UsageCredits` also accept observations
directly, including reactive host-query results. Both routes use the same display
components and exact decimal formatting.

```tsx
import {
  UsageBilling,
  type UsageBillingSnapshot,
  type UsageViewScope,
} from "@fantastic.dev/better-stripe/react";

const view: UsageViewScope = {
  identityKey: authenticatedSessionKey,
  accountKey: authorizedTenantKey,
  meterKey: originalMeterAndPriceVersionKey,
  period: verifiedBillingPeriod,
  currency: originalCurrency,
};

async function loadUsage(scope: UsageViewScope): Promise<UsageBillingSnapshot> {
  const response = await fetch("/api/billing/usage", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      meterKey: scope.meterKey,
      period: scope.period,
      currency: scope.currency,
    }),
  });
  if (!response.ok) throw new Error("Usage read unavailable");
  return response.json();
}

<UsageBilling scope={view} unit="API calls" load={loadUsage} />;
```

The scope is a cache identity, not authorization. Update `identityKey` on logout,
login or membership changes. Include original plan/price version in `meterKey`.
Changing identity, tenant, meter/version, period or currency resets the workflow
and its history navigation. Responses from the previous scope cannot replace the
current view. Period/currency mismatches in returned snapshots fail closed.

Authenticate every host read, refresh and page. Resolve the current tenant and
original native binding on the server. Do not trust a browser-selected payer,
price, subscription, secret or scope claim. See [authorization](usage-security.md).

The host loader should assemble `UsageBillingSnapshot` from existing package APIs:

| Snapshot field      | Authenticated server source                                                               |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `summary`           | `stripe.usage.getSummary`, wrapped as `available` with its `observedAt`                   |
| `provider`          | `stripe.usage.getProviderUsage`, or a fresh authorized `observeProviderUsage` action      |
| `allowance`         | `stripe.usage.getAllowanceStatus` for an included model or a configured pay-as-you-go cap |
| `credits`           | `stripe.usage.getCreditBalance` for the original prepaid binding                          |
| `purchase`          | `stripe.usage.getCreditPurchase` for the authorized original purchase ID                  |
| `creditApplication` | Authorized `stripe.usage.reconcileCreditPurchase` for that same original purchase         |

Wrap successful allowance/credit reads in `{ status: "available", observedAt,
value }`. Preserve `null` allowance as no configured policy. Return explicit
`unavailable` or `unsupported` observations when evidence cannot be read. Include
only fields relevant to the verified model. The UI does not initiate purchases,
configure limits, run work, reconcile funds automatically or poll Stripe.

For a reactive adapter, pass the same observations to `UsageSummary`,
`UsageAllowance` and `UsageCredits`. Treat `undefined` as loading. Clear results
when the authenticated scope changes; never pass a previous query's data as the
new scope's observation. The asynchronous workflow performs this reset itself.

## All three models and observation states

`UsageSummary` displays the original plan/version, per-meter and subscription-item
breakdown, accepted/effective/provider-accepted quantities, nonzero delivery
states and estimated charge. It preserves exact quantity strings, including
values beyond JavaScript's safe floating-point range. `formatUsageEstimate`
converts native minor-unit decimal estimates into exact major currency decimals,
including fractional cents; unsupported amounts stay unavailable.

Loading, empty, partial, unavailable and unsupported are separate states. A
complete zero-event local summary is empty. An unavailable summary is never zero.
Native stale/partial aggregates and possible ingestion delay remain visible.
Unknown/rejected/held delivery is distinct from acceptance and aggregation.
Estimates never become finalized or paid invoice amounts in these views.

`UsageAllowance` shows consumed plus reserved progress, included and remaining
units, overage, soft warnings and hard-cap observations. Its progress bar is
normalized for presentation; its accessible value text retains exact quantities.
A display is never permission to start work. Use the server's atomic reservation
API. The period is the verified managed billing period with no rollover, not a
calendar reset performed by React.

`UsageCredits` shows available, reserved, consumed, expired and frozen quantities,
purchase pending/ready/frozen/canceled status, exhaustion and native application
proof status. A frozen grant may hold units even while the overall account is
open. Pending purchase payment does not grant units. Consumption is not another
cash collection or a withdrawable balance. Pass the original currency when
presenting an application proof without a balance or purchase observation.

Refresh is explicit. Existing observations shown during refresh or a failed
refresh are marked potentially stale. Loader errors use a sanitized message.
Host adapters must also sanitize returned observation reasons and custom history
content before sending them to a browser.

## Bounded history

`UsageHistory<Row>` and `useUsageHistory<Row>` own cursor navigation, loading,
retry, scope reset and stale-request protection. They work with event, delivery,
allowance and credit history. The host provides a row key and presentation rather
than another pagination engine.

```tsx
import { UsageHistory } from "@fantastic.dev/better-stripe/react";
import type { UsageEventView } from "@fantastic.dev/better-stripe/usage";

<UsageHistory<UsageEventView>
  scope={view}
  historyKey="accepted-events"
  limit={25}
  load={async (scope, page) => {
    // This host endpoint authenticates this request and resolves its binding.
    const result = await loadAuthorizedEventPage(scope, page);
    return {
      status: "available",
      observedAt: result.observedAt,
      value: {
        records: result.events,
        cursor: result.cursor,
        isDone: result.isDone,
      },
    };
  }}
  getKey={(row) => row.receipt.eventId}
  renderRecord={(row) => (
    <p>
      {row.record.sourceEventId}: {row.record.quantity}{" "}
      {row.record.binding.plan.unit.name}, {row.delivery}
    </p>
  )}
/>;
```

Use `readCreditHistory`, `readCreditGrants`, `readAllowanceHistory` or
`readDeliveryHistory` in analogous authorized loaders. The component accepts
1–100 rows per page and opaque cursors up to 2,048 characters. Change `historyKey`
when changing reader kind, filters or transport cache semantics. Reauthorize
every page; a cursor never grants access. Partial or empty nonterminal pages do
not mean no history. Incomplete pages never establish complete totals. Missing, empty or repeated
nonterminal cursors stop forward navigation while preserving Previous and retry.

Render props receive the same hook state: data, loading/error, refresh, page,
previous/next and completeness. Native buttons support keyboard navigation;
status/alert regions announce loading and errors. Maintain these behaviors when
replacing defaults with a design system.

## Verification

The co-located React tests exercise large exact quantities, every billing model,
loading/empty/partial/stale/unsupported states, native lag, pending and held
credits, error sanitization, retries, cursor navigation and delayed responses
after each scope field changes. The packed consumer typechecks these public
exports. The deterministic browser fixture is
`scripts/fixtures/usage-ui.html`; it uses the package components and does not call
Stripe. Its UI captures are separate from native financial acceptance.

Run `pnpm run check:all` and verify your host's authorization and native setup
using the [setup guide](metering-setup.md). Package views do not replace the
[ledger](usage-ledger.md), [allowance](usage-limits.md) or
[paid-credit](usage-credits.md) work and recovery protocols.

Server adapters can import the `UsageViewScope` and `UsageBillingSnapshot` types
from `@fantastic.dev/better-stripe/usage` without importing React types. The React
entry point retains its existing exports.
