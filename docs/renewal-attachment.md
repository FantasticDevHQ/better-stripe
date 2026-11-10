# Attach a renewal schedule

Use `BetterStripe` from `@fantastic.dev/better-stripe/node` inside a Convex
`"use node"` action. The ordinary package entrypoint keeps Node-only internals
out of browser and default Convex bundles; attachment refuses there unless the
Node entrypoint has been imported in that same runtime.

Attachment creates a schedule from the current subscription. It does **not**
configure a replacement price, prove a future effective change, or change host
membership and entitlements. Configuration and provider-confirmed observation
are separate capabilities.

## Supported profile

The initial profile supports platform-owned **test-mode** subscriptions using
Stripe API version `2026-09-30.endive`. A test or restricted-test secret key is
required. Live keys are refused before any provider request.

The subscription must be active, have exactly one licensed recurring item,
use classic billing with an ordinary anchor, and keep the same cadence. The
replacement price can belong to another product. Both discount lists must be
explicitly empty and the billing customer's discount must be explicitly null.
Flexible billing, calendar-edge anchors, changed cadence, discounts and other
states refused by the existing preparation/preservation validators are unsupported.
No unsupported setting is silently removed.

The method reads the original subscription, target price and billing customer
again before dispatch. Changed paid terms, foreign identities and an existing
schedule are refused. Full captured provider material is compared; these reads
are a best-effort fence, not an atomic Stripe compare-and-swap. Another writer
can race the final read and POST. Coordinate subscription writers in the host.

## Prepare and retain the request

Authenticate the actor and obtain consent in your host application. Read the
exact selectors with `readRenewalPriceReplacementContext`; authorize those
selectors before doing so. Keep the logical identity, attach key and original
first-dispatch timestamp in durable host state. They must survive duplicate
requests without being regenerated.

```ts
import {
  BetterStripe,
  prepareRenewalAttachmentOperation,
} from "@fantastic.dev/better-stripe/node";

const context = await betterStripe.readRenewalPriceReplacementContext(ctx, {
  expected, // Exact authorized subscription, item, products, prices and period.
});
const prepared = await prepareRenewalAttachmentOperation({
  preparation: {
    subscription: context.subscription,
    targetPrice: context.targetPrice,
    billingCustomer: context.billingCustomer,
    expected,
    key: logicalOperationId,
  },
  authorization: { scope: hostScope, id: consentId, revision: consentRevision },
  logicalOperationId,
  attachKey, // Explicit caller-retained idempotency key.
  firstDispatchedAt, // Original Unix timestamp in seconds.
});
const operation = await ctx.runMutation(
  components.betterStripe.renewalOperations.mutations.createAuthorizedOperation,
  prepared.createArgs,
);
if (operation.status === "conflict") {
  // Resolve the identity conflict. Do not mint a replacement key automatically.
  return operation;
}
const result = await betterStripe.attachRenewalSchedule(ctx, {
  operationId: operation.operationId,
  requestBinding: prepared.requestBinding,
  authorizationQuery: internal.renewalAuthorization.authorizeAttachment,
});
```

`prepareRenewalAttachmentOperation` performs no provider I/O. Store its exact
`createArgs` and `requestBinding` before invoking the method. Reconstructing it
with a fresh timestamp would be a different operation, not recovery. The
component rejects changed creation material under the original logical identity.

The helper fixes the work deadline at 30 seconds after the original
`firstDispatchedAt`, with a 35-second outer bound. The runtime uses the original
wall and monotonic clock basis, refuses elapsed/regressed clocks and never
refreshes the window. Prepare immediately before the initial attempt, after
consent and context acquisition. Expired or interrupted operations need explicit
host investigation; this API does not restart them.

## Host authorization

The host query returns exactly `true` to authorize attachment, and receives:

- `capability: "renewal_attachment_v1"` and the component `operationId`.
- `authorizationScope`, `authorizationId` and `authorizationRevision`.
- `logicalOperationId`, `requestBinding` and the complete `expected` selectors.

Check the authenticated identity, current consent and revision, exact original
subscription/item/period and chosen target. Reject foreign or revoked grants.
The query runs before the attempt is reserved and before provider reads. It is
not an atomic lock against concurrent host revocation. Keep the query reference
in trusted server code; never accept it as a client-controlled authorization policy.
The component's stored authorization descriptor alone does not authenticate a
caller. Apply host authorization to journal creation and every readback too.

## Outcomes and readback

| Status                | Meaning                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `attached_incomplete` | The actual provider acknowledgement and receipt were retained. The schedule is attached but no replacement phase has been configured.         |
| `not_dispatched`      | The invocation refused before its provider write, such as denied authorization, expired timing, unsupported material or stale provider reads. |
| `conflict`            | The request binding changed, the original attempt was already reserved, or the provider returned an idempotency conflict.                     |
| `timeout`             | The original deadline elapsed. The outcome remains explicitly unknown because provider work can finish later.                                 |
| `unknown`             | A reserved invocation could not establish an acknowledged result. A provider write may have completed.                                        |

The first successful reservation wins. Concurrent or duplicate invocations make
no additional provider write. The SDK never retries, rotates keys, falls back to
an unkeyed request, configures a schedule, or releases/cancels one as rollback.
A lost response or timeout remains unknown; an observed matching schedule does
not count as the missing creation acknowledgement. Provider work may complete
after a deadline. Do not issue a new operation or key just because this call
returned unknown.

After host authorization, use the existing component journal queries:

```ts
const operation = await ctx.runQuery(
  components.betterStripe.renewalOperations.queries.loadAuthorizedOperation,
  { operationId },
);
const acknowledgement = await ctx.runQuery(
  components.betterStripe.renewalOperations.queries.readProviderAcknowledgement,
  { operationId },
);
// If operation.activeAttempt exists, use its attemptId with readAttempt
// and readStageEvent to inspect the retained dispatch/response/receipt events.
```

Returned `attemptId` values identify the retained attempt for success, timeout and unknown
results. Journal DATA remains readable after process exit, but does not recreate
live invocation authority. Restart recovery and explicit replay are not exposed
by this API. Retain unknown/conflict evidence and coordinate reconciliation with
the other writers before taking another action.

This API adds no real-Stripe verification claim by itself. Use the PR's current
sandbox evidence to assess the tested runtime and provider conditions. The
example app's full renewal UI and production adoption remain separate work.

## Sandbox qualification probe

With a dedicated test key supplied securely as `BTS_RENEWAL_SANDBOX_KEY`, run:

```sh
pnpm exec vitest run --project scripts scripts/renewal-sandbox.test.mjs --maxWorkers=1 --silent=false
```

The opt-in probe creates two products/prices and one customer-account subscription,
marks its test invoice paid out of band, invokes the public attachment method,
and verifies one POST, duplicate refusal and journal acknowledgement readback.
It uses real Stripe with a Convex-test component journal in Node, not a serving
Convex backend. It reports that distinction and sanitized fixture IDs explicitly.
Without the key, the test is skipped and supplies no provider evidence.

Cleanup is separate from the operation: it releases only an acknowledged fixture
schedule, cancels the fixture subscription, archives the fixture catalog and
closes the test buyer. An unresolved schedule outcome is held for investigation;
cleanup failure fails the probe. The method itself never performs rollback writes.
