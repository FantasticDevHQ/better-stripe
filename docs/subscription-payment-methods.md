# One existing subscription's card

`updateSubscriptionDefaultPaymentMethod` changes the attached card selected by
one existing V2 subscription. It does not set the customer's or account's shared
default, attach a new card, create a charge, or change another subscription.
The existing account-level `setDefaultPaymentMethod` remains unsupported for V2.

Use this API only from an authenticated server callback after establishing the
original subscription, payer, provider realm and selected card. SDK selectors
are not authentication or community authorization. Shared card setup and removal
remain the public `SaveCard` and `PaymentMethods` workflows.

## Public options and result

```ts
import type {
  SubscriptionPaymentMethodOptions,
  SubscriptionPaymentMethodResult,
} from "@fantastic.dev/better-stripe";

const original: SubscriptionPaymentMethodOptions = {
  stripeSubscriptionId: "sub_original",
  customerAccount: "acct_original_buyer",
  paymentMethodId: "pm_selected_card",
  idempotencyKey: "server-owned-original-command",
  // connectedAccountId: "acct_merchant", // omit for platform scope
};
```

The host must freeze all five selectors, including optional realm, together with
the command key. Each SDK invocation copies those primitive selectors before its
first asynchronous read, so later changes to the caller's options cannot retarget
that invocation. This does not authorize a changed tuple on a later retry.
Never derive an old subscription's payer from the user's current
account mapping or use a replacement community owner to rewrite its original
payer. An unattached card, legacy `customer`-only method, foreign payer, non-card
method or object from another realm does not qualify.

The operation reads the original subscription and card in that exact realm,
updates only `default_payment_method`, and reads the subscription again. The
original POST reply can be a cached idempotent response, so it cannot establish
current selection by itself. Confirmation requires the fresh subscription's ID,
payer and default method to still agree.

| Status        | Meaning                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `updated`     | Fresh provider observation confirms the original tuple and selected method; includes `observedAt`                 |
| `unsupported` | Managed Payments, an unknown/malformed Managed Payments flag, a non-V2 payer or a non-card method                 |
| `unavailable` | Invalid selector, failed pre-write read, or original subscription/payer/method mismatch; no update was dispatched |
| `unknown`     | A write may have happened, or its reply/fresh observation did not confirm the original selection                  |

Managed Payments must be explicitly `null` or `{ enabled: false }` for this
ordinary subscription operation. `{ enabled: true }` is unsupported; a missing
flag does not guess ordinary behavior. There is no automatic Portal or shared
account-default fallback. Stripe's [subscription update contract](https://docs.stripe.com/api/subscriptions/update)
describes the Managed Payments restriction and same-customer requirement.

An expanded default-method object must agree on card ID, type and original payer.
A later card selection, changed payer or lost final read returns `unknown`, even
when the earlier update reply appears successful. This is selection confirmation,
not proof that a later invoice will be paid or that the card remains usable.

The package forwards the caller's idempotency key unchanged. It adds no retry
loop or durable command store. The Stripe SDK may retry transport failures with
the same key. Reusing a key with changed parameters, changing realm on retry or
creating a replacement key is not an original-command retry. Provider retention
is not a perpetual exactly-once guarantee. Preserve unknown outcomes and reconcile
them through the original authorized target.

## Maintained Vite server callback reference

The Vite dashboard's public `PaymentMethods` / `usePaymentMethodsManager` render
props provide shared card loading, attachment/removal and safe UI feedback. Add
selection as a separate authenticated host action bound to an original command;
do not convert the demo persona selector into authorization or wire selection to
the shared account-default hint.

The following is a server helper reference, not an enabled demo endpoint.
`loadOriginal` is an application-owned authorization boundary: it must verify the
current session/operator, community billing permission, exact original contract
and immutable selected-card command before returning the tuple. It must reject
foreign, replaced or revoked contexts rather than construct a tuple from browser
account/subscription IDs.

```ts
import type { SubscriptionPaymentMethodOptions } from "@fantastic.dev/better-stripe";
import type { ActionCtx } from "./_generated/server";
import { stripe } from "./stripe/helpers";

type LoadOriginal = (
  ctx: ActionCtx,
  tokenIdentifier: string,
  commandId: string,
) => Promise<SubscriptionPaymentMethodOptions>;

export async function selectOriginalSubscriptionCard(
  ctx: ActionCtx,
  commandId: string,
  loadOriginal: LoadOriginal,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");
  const original = await loadOriginal(ctx, identity.tokenIdentifier, commandId);
  return stripe.updateSubscriptionDefaultPaymentMethod(ctx, { ...original });
}
```

The browser sends only its host-owned command selector to that action. The host
creates/freezes the command from the authorized original contract and selected
card, reauthorizes each invocation, and does not silently change its target on
retry. No generic component ownership field replaces that check.

Render `updated` as a current confirmed selection; render `unknown` with an
unconfirmed/retry explanation tied to the same command. Do not optimistically mark
another community's card default or treat fulfilled callbacks as confirmation
without checking their typed status. Production Dojo consumers supply Next.js
routing, Shadcn components, OKLCH theme variables, responsive accessible states,
next-intl copy and the corresponding Fumadocs contract.

Tests use the real public Stripe SDK with synthetic HTTP. They demonstrate
request scope and response qualification, not live V2 provider acceptance.
