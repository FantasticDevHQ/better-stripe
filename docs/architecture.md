# Component architecture

### Component-Owned Tables

The component manages 8 domain tables and 1 internal table:

| Table              | Description                                              |
| ------------------ | -------------------------------------------------------- |
| `accounts`         | V2 account records with identity and configuration state |
| `products`         | Stripe products with optional trial day management       |
| `prices`           | Stripe prices linked to products                         |
| `subscriptions`    | Subscription lifecycle with first-class trial tracking   |
| `checkoutSessions` | Checkout session state (embedded and redirect)           |
| `invoices`         | Invoice records with subscription metadata               |
| `payments`         | Payment intent records                                   |
| `payouts`          | Payout records for Connect/marketplace                   |
| `webhookEvents`    | Internal ledger for replay protection and observability  |

### App-Layer Tables

The consuming app maintains its own tables for business context. The component never reads or writes app tables directly. App tables are updated via sync triggers that run in the same transaction as component writes.

Example app-layer tables (from a typical integration):

- Linking products to app-specific entities (e.g., communities, teams)
- Linking subscriptions to app-specific purchase types
- Payout percentage configurations

### Trigger Flow

```
Stripe Webhook Event
  |
  v
Webhook handler: Verify signature + check ledger
  |
  v
syncWebhook (one mutation transaction)
  - Upsert component domain table
  - Run sync trigger                   --> App updates its own tables
  |                                        Throwing rolls back the upsert;
  |                                        Stripe retries and the failed
  |                                        ledger row is reprocessed
  v
Mark ledger row processed
  |
  v
Async hook (scheduled action)          --> App calls external APIs
                                           Failures do not roll back;
                                           hooks should be idempotent
```

### Package Entry Points

| Entry Point                                  | Contents                                                 |
| -------------------------------------------- | -------------------------------------------------------- |
| `@fantastic.dev/better-stripe`               | `BetterStripe` class, `registerRoutes`, TypeScript types |
| `@fantastic.dev/better-stripe/react`         | React hooks, headless UI components, formatting helpers  |
| `@fantastic.dev/better-stripe/testing`       | Test fixtures, mock webhooks, `assertTestEnvironment`    |
| `@fantastic.dev/better-stripe/convex.config` | Convex component registration                            |

### Error Handling

Structured errors are thrown as `ConvexError` with a `BetterStripeError` payload:

```typescript
interface BetterStripeError {
  code: BetterStripeErrorCode;
  message: string;
  stripeError?: {
    type: string;
    code?: string;
    message: string;
  };
}
```

Error codes: `ACCOUNT_NOT_FOUND`, `ACCOUNT_CREATE_FAILED`, `PRODUCT_NOT_FOUND`, `PRICE_NOT_FOUND`, `SUBSCRIPTION_NOT_FOUND`, `SUBSCRIPTION_UPDATE_FAILED`, `CHECKOUT_CREATE_FAILED`, `CHECKOUT_NOT_FOUND`, `PAYMENT_METHOD_FAILED`, `WEBHOOK_VERIFICATION_FAILED`, `WEBHOOK_DUPLICATE_EVENT`, `STRIPE_API_ERROR`, `TEST_ENV_REQUIRED`, `INVALID_CONFIGURATION`.

> **Note:** All methods that throw their own errors or catch-and-rethrow now use structured `ConvexError(BetterStripeError)` payloads. Methods that let uncaught Stripe SDK errors propagate are a separate policy decision and not yet aligned.
