# Component architecture

### Component-Owned Tables

The component schema is composed from domain modules. It includes provider
mirrors and retained financial, workflow and usage state. The authoritative table
inventory is [the component schema](../src/component/schema.ts); table names are
internal storage contracts, not an invitation for a host to write them directly.

| Domain                               | Component-owned state                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Accounts and catalog                 | Accounts, closed-account provenance, products and prices                                                                 |
| Billing and Connect                  | Subscriptions, checkout sessions, invoices, payments, payouts, refunds, disputes, transfers and reversal operations      |
| Webhooks                             | Event deduplication and processing state                                                                                 |
| Settlement and affiliate recovery    | Immutable allocations/commission decisions, original policy context, obligations, receipts, offsets and balances         |
| Recipient payouts                    | Policies, schedule operations, releases, claims, source allocations, snapshots, worker jobs and financial/risk revisions |
| Financial observations and ownership | Scoped ownership generations, complete source/transfer observations, reversal history and retained references            |
| Recovery and funding                 | Cost claims/reservations, processing-cost reconciliation, balance-funding operations and durable recovery requests       |
| Operation evidence                   | Bounded evidence headers and payloads                                                                                    |
| Usage catalog and subscriptions      | Immutable meter/price bindings, enrollment controls, intents, locks and history                                          |
| Usage ledger and delivery            | Scoped events, counters, reservations, transactional outbox, delivery locks/errors/history and provider observations     |
| Usage allowance and credits          | Allowance policies/history and payment-backed credit accounts, purchases, grants and history                             |
| Usage corrections                    | Correction operations, claims and auditable history                                                                      |
| Payout revision migration            | Revision journal, bounded migration jobs and results                                                                     |

The component installs its nested Workflow runtime through
`@fantastic.dev/better-stripe/convex.config`. Hosts supply internal provider
actions and authorization where required. See [durable execution](architecture/durable-execution.md)
and [the extraction boundary](architecture/component-extraction.md).

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

| Entry Point                                         | Contents                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `@fantastic.dev/better-stripe`                      | `BetterStripe` class, `registerRoutes`, TypeScript types             |
| `@fantastic.dev/better-stripe/react`                | React hooks, headless UI components, formatting helpers              |
| `@fantastic.dev/better-stripe/testing`              | Test fixtures, mock webhooks, `assertTestEnvironment`                |
| `@fantastic.dev/better-stripe/convex.config`        | Convex component registration and nested Workflow runtime            |
| `@fantastic.dev/better-stripe/usage`                | Shared usage schemas, exact quantity helpers and model configuration |
| `@fantastic.dev/better-stripe/_generated/component` | Generated component reference types                                  |

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

The [structured error definitions](../src/client/errors.ts) include account,
catalog, checkout, subscription, refund, dispute and configuration failures.
The usage APIs also expose domain-specific errors and explicit held/unknown
outcomes. See [usage contracts](metered-usage.md) and each workflow's recovery
contract. A successful transport call does not establish payment or settlement.

Methods that allow uncaught Stripe SDK errors to propagate remain a separate
error path. Do not assume every failure has the structured payload above.
