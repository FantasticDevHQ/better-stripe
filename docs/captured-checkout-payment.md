# Captured Checkout payment observations

`qualifyCapturedCheckoutPayment` is a server-side, read-only qualifier for an
already retrieved, expanded payment-mode Checkout Session. It makes no provider
request and performs no component or database write.

Retrieve the original Session with its PaymentIntent and latest charge expanded:

```ts
import { qualifyCapturedCheckoutPayment } from "@fantastic.dev/better-stripe";

// Authenticate the caller and resolve these values from the host's original
// purchase binding before retrieving provider data. Browser selectors and
// provider metadata do not authorize this read.
const session = await stripe.getCheckoutSessionFromStripe(ctx, {
  stripeSessionId: original.stripeSessionId,
  expand: ["payment_intent.latest_charge"],
});

const observation = qualifyCapturedCheckoutPayment(session, {
  stripeSessionId: original.stripeSessionId,
  customerAccountId: original.customerAccountId,
  livemode: original.livemode,
});

if (observation.status === "unavailable") {
  // Keep purchase/access verification pending or unavailable. Do not infer a
  // payment from the browser return URL or manufacture a webhook event.
  return { status: "unavailable", reason: observation.reason };
}

// Correlate these generic provider facts with the authorized original request.
return observation;
```

The qualifier requires a completed, paid, payment-mode Session, an expanded
succeeded PaymentIntent and its expanded paid, succeeded, fully captured charge.
Session, PaymentIntent and charge identities, buyer account, livemode, positive
safe-integer amounts and currency must agree. Missing or unexpanded objects,
partial capture and contradictory evidence cannot return `ready`.

The result is a discriminated union:

- `status: "ready"` includes `stripeSessionId`, `stripePaymentIntentId`,
  `stripeChargeId`, `customerAccountId`, `livemode`, `amount`, `currency`,
  `sessionMetadata` and `paymentIntentMetadata`.
- `status: "unavailable"` includes a reason of `invalid_context`,
  `invalid_evidence` or `identity_mismatch`.

`amount` remains an integer in Stripe's original-currency **minor units**. It is
not a decimal amount in major units: do not divide every currency by 100 or round
the provider value. Keep the currency with the amount and use the public currency
formatting helpers for display. Session and PaymentIntent metadata remain
separate string records for host correlation; they are not authentication.

## Historical capture is separate from authority

`ready` describes coherent evidence that the original payment was fully captured.
It does not require an invoice, processing fee or balance transaction. Delayed
fees do not make that captured payment unavailable, and a later refund does not
erase its historical capture. Current refund eligibility, dispute exposure,
settlement, payable balance and payout authority require their own APIs and
current policy checks.

This observation is not a reservation, verified webhook signature, durable
fulfillment receipt or access grant. The host still authenticates the actor,
binds the immutable request and original buyer/account, checks application
eligibility and decides whether to accept signed-original evidence and fulfill
the purchase. A signed webhook adapter may reuse this same qualifier after its
real signature verification and original correlation. Calling the qualifier does
not create a signed event or replace that adapter's transaction and replay rules.

## Authorized Vite receipt read

The Vite reference exposes two functions under
`example/convex/billing/capturedReceipt/`:

- `queries.context({ stripeSessionId })` authenticates through the existing
  `historyActor` mapping and returns only `{ actorId, accountId, sessionId }`.
  The original cached Session must be payment-mode, belong to that actor and
  reference a unique personal account owned by the same actor. Missing, foreign
  or organization-scoped Sessions, and missing, foreign, ambiguous or
  organization-scoped account mappings receive the same generic authorization
  rejection. The cached Session reader does not establish Session uniqueness.
- `actions.read({ stripeSessionId })` calls that same query on the server for
  each read. It does not accept an actor or account supplied by the browser.
  After the example's test-mode key guard, it retrieves the original Session
  with `payment_intent.latest_charge` expanded and calls the public
  `qualifyCapturedCheckoutPayment` helper.

The action returns `status: "ready"` with the original Session, PaymentIntent,
charge and account IDs, livemode, integer minor-unit amount and currency. It
omits both metadata records, client secrets, URLs and raw provider errors. For an
authorized actor, incomplete or unavailable provider evidence returns
`{ status: "unavailable" }`. Authorization failures remain rejections; they do
not become successful empty reads or evidence that a payment is pending.

The default demo is anonymous. Choosing a demonstration buyer or account does
not authenticate it, and this integration does not install an authentication
provider. A host must supply verified Convex authentication and the existing
unique token-to-user mapping before an authorized receipt read is available.

For the mounted receipt workflow, use the authoritative context triple as the
public `useWorkflowAction` scope and keyed child identity. Loading, absent or
rejected context must remove the previous receipt. Actor or account changes
must invalidate it even if the Session ID and authenticated boolean stay the
same. A late response or retry belongs only to its original scope. Show a fixed,
sanitized unavailable view for query/action failures, never the raw error.

Only a `ready` result maps to the public `PaymentReceipt` presentation
`{ status: "succeeded", amount, currency }`. Do not pass `ready` directly as a
payment status, invent a zero amount or default currency, or infer capture from
a cached Session's `complete` status. Host components retain their styles and
routing; the SDK workflow and receipt remain the shared presentation primitives.

This reader performs no fulfillment or access write. It is separate from the
signed-adapter sketch below and does not turn a provider read into signed-original
purchase evidence.

## Reuse from a real signed adapter

The Vite receipt reader does **not** implement a durable signed-original Checkout
fulfillment consumer. The following is a host integration sketch, not an
implemented example handler or an additional package API:

```ts
import {
  qualifyCapturedCheckoutPayment,
  registerRoutes,
} from "@fantastic.dev/better-stripe";

registerRoutes(http, components.betterStripe, {
  stripeSecretKey,
  webhookSecret,
  onEvent: async (ctx, event) => {
    // registerRoutes has verified the real webhook signature before this hook.
    if (!("data" in event) || event.type !== "checkout.session.completed")
      return;

    // These two functions are host-owned: resolve the immutable original, then
    // apply its transactional acceptance/replay policy. They are not SDK APIs.
    const original = await readOriginalForVerifiedEvent(ctx, {
      eventId: event.id,
      stripeSessionId: event.data.object.id,
    });
    const session = await stripe.getCheckoutSessionFromStripe(ctx, {
      stripeSessionId: original.stripeSessionId,
      expand: ["payment_intent.latest_charge"],
    });
    const observation = qualifyCapturedCheckoutPayment(session, {
      stripeSessionId: original.stripeSessionId,
      customerAccountId: original.customerAccountId,
      livemode: original.livemode,
    });
    if (observation.status !== "ready") return;
    await acceptOriginalPayment(ctx, {
      eventId: event.id,
      original,
      observation,
    });
  },
});
```

The host must retain the actual verified event identity, reconcile it with the
original purchase, and make acceptance and entitlement writes under its existing
atomic/replay rules. The fetched Session remains a read-time provider
observation; the qualifier does not assert that it was the signed event payload.
Do not construct a `Stripe.Event` from a receipt read or invoke webhook-only
processing merely to qualify a captured payment. Existing applications can share
the qualifier between their authorized reader and their genuine signed adapter
without duplicating the generic capture validator.

## Receipt presentation

For receipt presentation, keep the public React `PaymentReceipt` workflow and
host render props. Supply an authoritative server payment projection only after
the host's receipt policy accepts it. A successful browser `confirm()` means
confirmation was submitted; it does not establish paid status or access. The
host retains authorization, receipt refresh, entitlement decisions, localization
and styling. See [React workflows](react-workflows.md) and
[refund context](refund-context.md) for their separate contracts.
