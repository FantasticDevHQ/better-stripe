# Server-gated payments

Use `betterStripe.paymentControl` when your server, not the browser, must decide
whether a payment may complete. A typical case is a short hold: an amount is
reserved for a few minutes, and a payment for an expired hold must be refused or
cancelled, never captured.

A hosted or embedded Checkout Session, or a PaymentIntent whose client secret is
already in the browser, stays payable until it expires or is cancelled. Hiding it
in the UI does not revoke it, and Checkout's shortest expiry is 30 minutes. With
server confirmation, no PaymentIntent exists until your server confirms it, so
nothing payable outlives a hold.

| Method                                            | Purpose                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `paymentControl.confirm(ctx, opts)`               | Create and confirm a PaymentIntent from a Stripe.js ConfirmationToken, on the server. |
| `paymentControl.cancel(ctx, opts)`                | Cancel a payment the component created. Idempotent.                                   |
| `paymentControl.getState(ctx, opts)`              | Read the live provider state of a payment the component created.                      |
| `paymentControl.expireCheckoutSession(ctx, opts)` | Expire an open Checkout Session the component created. Idempotent.                    |

All four are server APIs. Call them from your own Convex actions after you have
authenticated the caller and authorized the payment. Never forward browser-chosen
amounts, user IDs, or metadata.

## Flow

1. The browser mounts the Payment Element in deferred-intent mode, with the
   amount and currency your server quoted, and creates a ConfirmationToken.
2. The browser sends the token ID (`ctoken_…`) to your action.
3. Your action checks, in one mutation, that the hold is still active and records
   that the payment was sent. If the hold has ended, it refuses. Nothing is
   charged.
4. Your action calls `paymentControl.confirm` with the server-priced amount and an
   optional `notAfter` deadline.
5. If the result is `requires_action`, the browser completes authentication with
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
// Server: your Convex action.
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
      amount: hold.amount,
      currency: hold.currency,
      confirmationTokenId: args.confirmationTokenId,
      idempotencyKey: `hold:${hold._id}:attempt:${hold.attempt}`,
      notAfter: hold.expiresAt + GRACE_MS,
      metadata: { holdId: hold._id },
    });
    await ctx.runMutation(internal.holds.recordPayment, {
      holdId: hold._id,
      paymentIntentId: result.paymentIntentId,
      status: result.status,
    });
    return result;
  },
});
```

### Confirmation options

- `userId` (required, nonempty). The component stores it as `metadata.userId`, and
  `cancel` and `getState` match it exactly. For a guest, use an ID scoped by your
  host, such as `guest:<purchaseId>`.
- Either `amount` (a positive integer in minor units) and `currency` (three
  lowercase letters), or `stripePriceId` for an active, fixed, one-time price.
- `customerAccount` (optional). A V2 buyer account (`acct_…`) that must belong to
  `userId` in the component.
- `idempotencyKey` (required). Use a new key for each confirmation attempt, and
  reuse it only to retry that same attempt.
- `notAfter` (optional), in Unix milliseconds. The component checks it before any
  provider request and again just before the PaymentIntent is created. A late
  call throws `PAYMENT_CONFIRMATION_REFUSED` without contacting Stripe. Choose a
  value no earlier than the time your own mutation accepted as "sent".
- `paymentMethods`: `"card"` (default) or `"automatic"`. `"automatic"` requires
  `returnUrl`, because redirect-based methods return through it.
- `metadata`, `receiptEmail`. Keys starting with `bs` and the `userId` key are
  reserved for the component.

The result is `{ paymentIntentId, status, clientSecret?, lastPaymentError? }`:

- `succeeded`: paid. Fulfil from your verified webhook flow as usual.
- `processing`: Stripe is settling the payment. Keep the hold until a webhook or
  `getState` reports `succeeded`, `canceled`, or `requires_payment_method`.
- `requires_action`: the only status that returns `clientSecret`, for
  `stripe.handleNextAction`. Never persist or log it.
- `requires_payment_method` with `lastPaymentError`: the attempt failed, for
  example a decline. It is reported instead of thrown. The PaymentIntent cannot
  be paid from the browser, because its secret never left the server. Cancel it,
  then let the buyer try again with a new ConfirmationToken and idempotency key.

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
| `not_cancelable`   | It is `processing`; Stripe will settle it.            | Keep until it settles. |

The method reads the payment first and cancels only from a cancellable status.
If the payment changes state between that read and the cancel (for example the
buyer finishes authentication), it reads again and reports what Stripe says. It
never reports a paid payment as cancelled.

A payment that is in flight before your deadline (`requires_action` or
`processing`) is not cancelled by the deadline itself. Keep its hold, and cancel
it only after a bounded grace period if it never reaches a terminal status.

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

`cancel` and `getState` require the payment's `metadata.userId` to equal `userId`.
When you pass `customerAccount`, the account must belong to `userId` in the
component and match the payment's V2 `customer_account`. A payment that does not
match, or that the component did not create, throws `PAYMENT_NOT_FOUND` without
revealing whether it exists. A Checkout Session not recorded for `userId` throws
`CHECKOUT_NOT_FOUND`. Invalid selectors throw `INVALID_CONFIGURATION` before any
provider request. Other provider errors propagate.

## Verification

The package tests drive the real Stripe SDK and the real component database
against a synthetic, stateful Stripe HTTP layer. They cover confirmation outcomes,
deadline refusal, ownership, idempotent cancel and expiry, and a buyer who
completes payment while the host is cancelling. They make no network requests.
They do not replace a live Stripe test-mode run in your app with real Stripe.js
and authentication.
