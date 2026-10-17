# Durable balance funding

`BetterStripe.balanceFundingWorkflow` adds component-owned preparation and apply workflows. The existing `prepareBalanceFunding` and `setBalanceFunding` methods remain available. The new interface requires explicit `2026-06-30.preview` configuration; the provider action checks the actual Stripe SDK version against the immutable operation snapshot before admitting a provider phase. Stripe still determines live account and preview eligibility.

The host authorizes the account, subscription and opaque scope, records consent, and supplies an internal provider action reference. Construct the Stripe client inside that action using the host's runtime secret. The component stores only the function handle, immutable scope/API/definition versions, phase keys and allowlisted receipts. Never put keys, raw provider objects, raw exceptions or restoration settings into workflow arguments or completion context.

```ts
// Host internal action. Instantiate BetterStripe at execution, not in durable args.
const stripe = () =>
  new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    stripeApiVersion: "2026-06-30.preview",
  });

// The action's args validator must match FundingProviderPhaseOptions:
// accountId, scopeKey, operationId, version, stripeSubscriptionId,
// providerApiVersion, definitionVersion, phase (create|attach|apply), providerKey.
// Use ordinary string validators for component operation IDs in the host.
export const fundingProvider = internalAction({
  args: providerPhaseArgs,
  handler: (ctx, args) =>
    stripe().balanceFundingWorkflow.executeProviderPhase(ctx, args),
});

// Inside an authorized host action:
const result = await stripe().balanceFundingWorkflow.prepare(ctx, {
  accountId,
  scopeKey,
  stripeSubscriptionId,
  requestKey,
  consent: true,
  consentAt,
  consentReference,
  providerAction: internal.billing.fundingProvider,
});
```

`prepare` recovers the original public request before reading provider settings again. A new request for an existing canonical preparation uses its original consent and restoration snapshot. Capture performs read-only provider calls; the component persists that snapshot before scheduling create or attach. Duplicate requests join the bound workflow. A successful preparation does not enable funding: use the existing safe `getPreparation` query to obtain a verified preparation ID, then call `apply(ctx, { accountId, scopeKey, stripeSubscriptionId, preparationId, enabled, consent, requestKey, providerAction })`. Enabling requires consent. Disabling restores the persisted original payment method and nullable payment-method-type settings, never current subscription prices or host metadata.

`inspect(ctx, operationReference)` returns only scoped operation state, version and cancellation state. `resume` and `cancel` accept the same account/scope/subscription/operation/version reference. These control paths do not instantiate Stripe or require its secret. The host must authorize these operations before calling them; component APIs are server capabilities, not browser authorization policies.

Every provider phase has one atomic dispatch claim and its original idempotency key. SDK write retries and Workflow action retries are disabled. A lost create response with no verified payment-method ID remains held: ordinary PaymentMethod reads cannot prove which unattached resource was created. Resume never creates another method in that state. Unknown attachment or apply outcomes use known-ID, read-only provider reconciliation; an inconclusive readback stays held and does not repeat the write. Conflicting targets cannot replace the active operation or its original restoration settings.

Positive receipts are persisted before the bridge returns and again in a separate workflow mutation. If storage fails after provider success, retained, scope-bound provider journal receipts can restore canonical evidence. Resume restarts only a known failed step or finishes from complete verified receipts; it does not repeat completed provider effects. Cancellation is a request, not proof that an in-flight provider call stopped. It retains uncertain claims and restoration data; known positive receipts may still be reconciled and finished afterward.

Operations pin `balance-funding/v1` and their original provider API version. A changed definition or API version is held rather than replayed. Compatible old definitions and pinned host provider configuration must remain available while operations are incomplete. History reads are bounded and require completeness. Cleaned, missing or incompatible history cannot authorize a new workflow or effect; retained operation receipts are never deleted by this interface. Do not clean workflow history while uncertain operations still need reconciliation.

This proves durable local orchestration and conservative replay boundaries, not exactly-once provider effects. Tests use the actual nested Workflow/Workpool components and real Stripe SDK transport with synthetic responses. The local installation uses a dummy key and does not establish live Stripe eligibility or perform live provider writes.
