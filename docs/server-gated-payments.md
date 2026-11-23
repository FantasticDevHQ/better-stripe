# Server-gated payments

Use `betterStripe.paymentControl` when your server, not the browser, must decide
whether a payment may complete. A typical case is a short hold: an amount is
reserved for a few minutes, and a payment for an expired hold must be refused or
cancelled, never captured.

A hosted or embedded Checkout Session, or a PaymentIntent whose client secret is
already in the browser, stays payable until it expires or is cancelled. Hiding it
in the UI does not revoke it, and Checkout's shortest expiry is 30 minutes.

Server-gated payments are prepared and confirmed in two steps on the server.
`prepare` creates an unconfirmed, card-only PaymentIntent and returns only its
ID: no client secret leaves the server, so the browser cannot pay it. `confirm`
is the only way it becomes payable, and it is refused once your deadline has
passed. After the deadline, nothing can confirm it. You can only read it and
cancel it.

A payment confirmed inside the hold can still be in flight afterwards. A
`requires_action` payment stays payable through its authentication step until it
completes or you cancel it. Keep the hold for in-flight payments, and bound them
with `cancel` (see [Cancel when the hold ends](#cancel-when-the-hold-ends)).

| Method                                            | Purpose                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `paymentControl.prepare(ctx, opts)`               | Create an unconfirmed, card-only PaymentIntent for a server-priced amount.        |
| `paymentControl.confirm(ctx, opts)`               | Confirm a prepared payment from a Stripe.js ConfirmationToken, before a deadline. |
| `paymentControl.cancel(ctx, opts)`                | Cancel a payment the component created. Idempotent.                               |
| `paymentControl.getState(ctx, opts)`              | Read the live provider state of a payment the component created.                  |
| `paymentControl.expireCheckoutSession(ctx, opts)` | Expire an open Checkout Session the component created. Idempotent.                |

All of them are server APIs. Call them from your own Convex actions after you
have authenticated the caller and authorized the payment. Never forward
browser-chosen amounts, user IDs, or metadata.

## Flow

1. When the hold starts, your action calls `paymentControl.prepare` with the
   server-priced amount and stores the returned `paymentIntentId` on the hold.
2. The browser mounts the Payment Element in deferred-intent mode, card only,
   with the same amount and currency, and creates a ConfirmationToken.
3. The browser sends the token ID (`ctoken_…`) to your action.
4. Your action checks, in one mutation, that the hold is still active and records
   that the payment was sent. If the hold has ended, it refuses. Nothing is
   charged.
5. Your action calls `paymentControl.confirm` with the stored `paymentIntentId`,
   the token and a `notAfter` deadline.
6. If the result is `requires_action`, the browser completes authentication with
   the returned `clientSecret`.

```ts
// Browser: Stripe.js with the Payment Element in deferred-intent mode.
const elements = stripe.elements({
  mode: "payment",
  amount: quote.amount,
  currency: quote.currency,
  paymentMethodTypes: ["card"],
});
// ...mount a Payment Element, then on submit:
await elements.submit();
const { confirmationToken, error } = await stripe.createConfirmationToken({
  elements,
});
if (error) return showError(error);
const result = await payForHold({
  holdId,
  confirmationTokenId: confirmationToken.id,
});
if (result.status === "requires_action")
  await stripe.handleNextAction({ clientSecret: result.clientSecret });
```

```ts
// Server: when the hold starts.
const { paymentIntentId } = await betterStripe.paymentControl.prepare(ctx, {
  userId,
  amount: hold.amount,
  currency: hold.currency,
  idempotencyKey: `hold:${hold._id}:prepare`,
  metadata: { holdId: hold._id },
});
await ctx.runMutation(internal.holds.attachPayment, {
  holdId: hold._id,
  paymentIntentId,
});

// Server: your Convex action for the pay button.
export const payForHold = action({
  args: { holdId: v.id("holds"), confirmationTokenId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    // Atomically: the hold is active, belongs to userId, and is now marked sent.
    const hold = await ctx.runMutation(internal.holds.markPaymentSent, {
      holdId: args.holdId,
      userId,
    });
    const result = await betterStripe.paymentControl.confirm(ctx, {
      userId,
      paymentIntentId: hold.paymentIntentId,
      confirmationTokenId: args.confirmationTokenId,
      notAfter: hold.expiresAt + GRACE_MS,
    });
    await ctx.runMutation(internal.holds.recordPayment, {
      holdId: hold._id,
      status: result.status,
    });
    return result;
  },
});
```

### Prepare options

- `userId` (required, nonempty). The component stores it as `metadata.userId`, and
  `confirm`, `cancel` and `getState` match it exactly. For a guest, use an ID
  scoped by your host, such as `guest:<purchaseId>`.
- Either `amount` (a positive integer in minor units) and `currency` (three
  lowercase letters), or `stripePriceId` for an active, fixed, one-time price.
- `customerAccount` (optional). A V2 buyer account (`acct_…`) that must belong to
  `userId` in the component.
- `idempotencyKey` (required). Reuse it only to retry the same preparation. If a
  prepare response is lost, retry with the same key: Stripe replays the original
  PaymentIntent. An unconfirmed PaymentIntent cannot be paid from the browser,
  so a retry is safe at any time.
- `metadata`, `receiptEmail`. Keys starting with `bs` and the `userId` key are
  reserved for the component.

The result is `{ paymentIntentId, status, amount, currency }`. It never includes
a client secret.

### Confirm options

- `userId`, `paymentIntentId` and, when you used one, `customerAccount`.
- `confirmationTokenId` (required): the `ctoken_…` ID from Stripe.js.
- `notAfter` (recommended), in Unix milliseconds. The component checks it before
  any provider request and again immediately before the confirmation. A late call
  throws `PAYMENT_CONFIRMATION_REFUSED` without contacting Stripe. The refusal
  covers only that call: an earlier confirmation whose response you lost may
  still have taken effect, so read the payment with `getState` before you release
  the hold. Choose a value no earlier than the time your own mutation accepted as
  "sent".
- `returnUrl` (optional). Passed to Stripe for authentication flows that redirect.

`confirm` only confirms a payment in `requires_payment_method` or
`requires_confirmation`. A payment that is already in flight or finished is
reported as it is and is never confirmed twice.

The result is `{ paymentIntentId, status, clientSecret?, lastPaymentError? }`:

- `succeeded`: paid. Fulfil from your verified webhook flow as usual.
- `processing`: Stripe is settling the payment. Keep the hold until a webhook or
  `getState` reports `succeeded`, `canceled`, or `requires_payment_method`.
- `requires_action`: the only status that returns `clientSecret`, for
  `stripe.handleNextAction`. Never persist or log it.
- `requires_payment_method` with `lastPaymentError`: the attempt failed, for
  example a decline. It is reported instead of thrown. The buyer can try again
  with a new ConfirmationToken on the same `paymentIntentId`, while the hold
  lasts.

### Recover an uncertain confirmation

If `confirm` fails without a result (for example the network dropped the
response), you still have the `paymentIntentId` from `prepare`. Read it with
`getState`:

- `requires_payment_method` or `requires_confirmation`: the confirmation never
  took effect. If the hold has ended, `cancel` it and release the hold. Otherwise
  the buyer can try again before the deadline.
- `requires_action`, `processing` or `succeeded`: it took effect inside the hold.
  Treat it as an in-flight payment.

`confirm` is always refused after `notAfter`, so recovery can never confirm a
payment late. A cancel also wins over a confirmation request that arrives at
Stripe after it: Stripe does not confirm a cancelled PaymentIntent.

## Cancel when the hold ends

```ts
const result = await betterStripe.paymentControl.cancel(ctx, {
  userId,
  paymentIntentId,
  reason: "abandoned",
});
```

`outcome` tells you what to do with the hold:

| `outcome`          | Meaning                                               | Hold                   |
| ------------------ | ----------------------------------------------------- | ---------------------- |
| `canceled`         | This call cancelled the payment.                      | Release.               |
| `already_canceled` | It was already cancelled. No provider write was made. | Release.               |
| `succeeded`        | It was paid before the cancel took effect.            | Keep: it is paid.      |
| `not_cancelable`   | It is `processing` and Stripe refused to cancel it.   | Keep until it settles. |

The method reads the payment first. It returns at once for a payment that is
already cancelled or succeeded, and otherwise asks Stripe to cancel it. That
includes `processing`, which Stripe can cancel for some payment methods but not
for cards.
If the payment changes state between that read and the cancel (for example the
buyer finishes authentication), it reads again and reports what Stripe says. It
never reports a paid payment as cancelled.

A payment that is in flight before your deadline (`requires_action` or
`processing`) is not cancelled by the deadline itself. Keep its hold, and call
`cancel` after a bounded grace period if it has not reached a terminal status.
Release the hold on `canceled` or `already_canceled`.

`not_cancelable` means the card payment is already `processing`: the buyer
finished the payment and Stripe is settling it. Neither the component nor Stripe
can stop it. Stripe moves it to `succeeded` or `requires_payment_method` and
sends the matching webhook. Card payments rarely stay in `processing` for long,
but Stripe does not document a guaranteed time bound, and neither does this
package. Keep the hold until a terminal status arrives, and read it with
`getState` if you need to. Server-gated payments
are card-only because delayed methods, such as bank debits, can stay
`processing` for days.

## Read the authoritative state

```ts
const state = await betterStripe.paymentControl.getState(ctx, {
  userId,
  paymentIntentId,
});
```

This reads the PaymentIntent from Stripe without waiting for a webhook. It works
for any PaymentIntent the component created with `metadata.userId`, including
those created by `createPaymentIntent` and component Checkout Sessions. It returns
`status`, `amount`, `amountReceived`, `currency`, `createdAt`, `canceledAt`,
`cancellationReason`, `lastPaymentError`, `latestChargeId`, `customerAccount`,
`livemode`, host `metadata` and `observedAt`. It never returns the client secret
or the raw provider object.

`status` is the closed union `requires_payment_method | requires_confirmation |
requires_action | processing | requires_capture | canceled | succeeded`. An
unknown provider status fails the read instead of widening the type.

Grant access only through your verified webhook or settlement flow. A state read
is evidence for decisions about the hold. It is not a fulfilment trigger.

## Expire a Checkout Session

```ts
const result = await betterStripe.paymentControl.expireCheckoutSession(ctx, {
  userId,
  stripeSessionId,
});
// result.outcome: "expired" | "already_expired" | "complete"
```

The session must be recorded in the component (created through
`createCheckoutSession` or a prepared checkout) with the same `userId`. An open
session is expired, and a repeat call is a no-op. A session that completed first
is reported as `complete` and left alone. The component's checkout row is updated
to the provider status.

## Ownership and errors

`confirm`, `cancel` and `getState` require the payment's `metadata.userId` to equal `userId`.
The component writes that key on every PaymentIntent it creates and does not let
host metadata override it. The check proves that the payment carries this
ownership attribution. It does not prove that the component created it: a
PaymentIntent created elsewhere on the same Stripe account with the same
`metadata.userId` also matches. Pass only payment IDs from your own records.
When you pass `customerAccount`, the account must belong to `userId` in the
component and match the payment's V2 `customer_account`. A payment that does not
match throws `PAYMENT_NOT_FOUND` without revealing whether it exists. A Checkout Session not recorded for `userId` throws
`CHECKOUT_NOT_FOUND`. Invalid selectors throw `INVALID_CONFIGURATION` before any
provider request. Other provider errors propagate.

## Verification

The package tests drive the real Stripe SDK and the real component database
against a synthetic, stateful Stripe HTTP layer. They cover preparation and confirmation outcomes,
deadline refusal, recovery when a confirmation response is lost after Stripe
applied it and when the request never reached Stripe, a lost prepare response,
no second confirmation of an in-flight payment, ownership,
idempotent cancel and expiry, processing payments Stripe can and cannot cancel,
a Checkout Session created through the component and then expired, and a buyer
who completes payment while the host is cancelling. They make no network requests.
They do not replace a live Stripe test-mode run in your app with real Stripe.js
and authentication.
