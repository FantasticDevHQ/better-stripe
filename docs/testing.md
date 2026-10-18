# Testing utilities

Import from `@fantastic.dev/better-stripe/testing`.

### assertTestEnvironment

Guards against running test fixtures with live Stripe keys:

```typescript
import { assertTestEnvironment } from "@fantastic.dev/better-stripe/testing";

assertTestEnvironment(); // Throws if STRIPE_SECRET_KEY does not start with sk_test_
```

### Fixture Factories

Typed factories for creating Stripe test data:

```typescript
import {
  createTestAccount,
  createTestPrice,
  createTestProduct,
  createTestSubscription,
} from "@fantastic.dev/better-stripe/testing";

const account = await createTestAccount(stripe, { email: "test@example.com" });
const product = await createTestProduct(stripe, { name: "Pro Plan" });
const price = await createTestPrice(stripe, {
  productId: product.id,
  unitAmount: 2999,
  interval: "month",
});
```

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
  stripeSessionId: "cs_test_123",
  metadata: { userId: "user_abc" },
});
```
