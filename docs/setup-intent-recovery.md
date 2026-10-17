# Read an original saved-card setup

`getSetupIntentFromStripe` reads an already acknowledged SetupIntent. It does not create, confirm, attach, search for, or retry creation of a setup. Authenticate the host request and resolve its immutable original tuple before calling it. A URL `setup_intent` or `redirect_status` is not authorization or success evidence.

```ts
const original = await requireOwnedOriginalSetupRequest(ctx, requestId);
const observation = await betterStripe.getSetupIntentFromStripe(ctx, {
  userId: original.userId,
  customerAccount: original.customerAccount,
  setupIntentId: original.setupIntentId,
  usage: original.usage,
});
await requireSameOriginalSetupAuthority(ctx, original);
return observation;
```

The two authorization helpers above belong to the host. They must check the enabled authenticated user, original consent and request, current session and original account association before and after provider I/O. The browser supplies an opaque host request correlation hint, not the customer, user, usage or provider ID selectors. Do not add a permissive example action that forwards those browser selectors.

The SDK copies all four primitive selectors before its first await. It resolves the exact component account with `requireUnique: true`, rejects absent or foreign ownership, and makes one exact platform-realm GET. The result must agree with the original ID, V2 `customer_account`, `metadata.userId` and usage. This matches the platform realm of `createSetupIntent`; it does not infer a connected-account realm or supply host authorization. Provider errors propagate and mismatched observations are rejected.

The narrow result contains `setupIntentId`, `customerAccount`, `usage`, supported `status` and `observedAt` in Unix milliseconds. A transient `clientSecret` is included only for `requires_payment_method`, `requires_confirmation` or `requires_action`; those states require a nonempty secret. `processing`, `canceled` and `succeeded` omit it. Never persist or log the secret, put it in analytics, or expose it outside the authenticated original request. The SDK does not return the raw provider object, metadata, card details or payment method.

A host may resume the original public `SaveCard` confirmation through its authenticated callbacks and refresh the reactive payment-method list only after a qualified `succeeded` observation. A setup observation does not change an account-wide or subscription default. The host still owns redirect routing, reload correlation, stale-form disposal, translated errors and consent policy. The tagged Vite dashboard's tokenization/attach example is not an authenticated SetupIntent return route; its maintained callback must use the server authorization pattern above before adopting this read.

If a dispatch outcome is unknown and the host never acknowledged a SetupIntent ID, this operation cannot recover it. Keep that attempt unknown. Do not search by metadata or repeat creation with a fresh key, and do not assume a provider idempotency retention period provides permanent recovery. This read has no package retry loop or new key; the configured SDK transport may apply its existing read retry policy.

Focused tests exercise the actual SDK with synthetic HTTP, including tuple mismatches, strict account selection, incomplete secret policy, terminal secret omission, provider failure and caller-input mutation. They are not live V2 or browser/SCA acceptance. Package source acceptance, an independently verified official release, host adoption and a complete authenticated return/reload flow are separate delivery gates.
