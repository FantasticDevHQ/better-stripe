# Testing utilities

Import from `@fantastic.dev/better-stripe/testing`.

### assertTestEnvironment

Validate the exact secret used to construct a raw stripe-node client before
running native fixtures. The helper accepts an explicit key or falls back to
`process.env.STRIPE_SECRET_KEY`:

```typescript
import { assertTestEnvironment } from "@fantastic.dev/better-stripe/testing";

assertTestEnvironment(process.env.STRIPE_SECRET_KEY); // Throws for missing/non-test keys.
```

### Fixture Factories

Typed factories create Stripe sandbox resources through a raw `Stripe` SDK,
not a `BetterStripe` instance:

```typescript
import Stripe from "stripe";
import {
  assertTestEnvironment,
  createTestAccount,
  createTestPrice,
  createTestProduct,
  createTestSubscription,
} from "@fantastic.dev/better-stripe/testing";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("Sandbox key required");
assertTestEnvironment(key);
const stripe = new Stripe(key);

const account = await createTestAccount(stripe, { email: "test@example.com" });
const product = await createTestProduct(stripe, { name: "Pro Plan" });
const price = await createTestPrice(stripe, {
  productId: product.id,
  unitAmount: 2999,
  interval: "month",
});
```

Keep the validated key and SDK instance together. The factories' internal guard
can fall back to the process environment when the SDK does not expose its key;
it does not independently attest an arbitrary SDK client. Do not pass a different
client while validating only the environment's test key.

These helpers create native Stripe test resources, not component mirror rows.
`createTestSubscription` takes a classic Stripe Customer ID in `customerId`;
do not pass an Accounts v2 `acct_...` ID there. Use the configured public
BetterStripe subscription APIs for Accounts v2 application flows.

### Mock Webhook Events

Factories for creating mock webhook events in tests:

```typescript
import {
  mockAccountUpdated,
  mockCheckoutCompleted,
  mockInvoicePaid,
  mockSubscriptionUpdated,
} from "@fantastic.dev/better-stripe/testing";

const event = mockCheckoutCompleted({
  id: "cs_test_123",
  metadata: { userId: "user_abc" },
});
```

`mockAccountUpdated` produces a classic `account.updated` snapshot fixture.
It is not an Accounts v2 thin-event fixture. Thin-event tests must supply the
appropriate event reference and mock the original provider lookup separately.
The factories construct test payloads; they do not sign HTTP webhook requests.
