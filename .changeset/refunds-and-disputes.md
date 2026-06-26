---
"@getdojo/better-stripe": minor
---

Add refund and dispute tracking (plan 011).

**New webhook events** added to `BETTER_STRIPE_WEBHOOK_EVENTS` (add these to your event destination / endpoint's `enabledEvents`):

- Refunds: `refund.created`, `refund.updated`, `refund.failed`
- Disputes: `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated`

**New component tables:** `refunds` and `disputes`, synced from those events. Refunds denormalize cumulative state onto the linked `payments` row — two new optional fields, `refundedAmount` and `refundStatus` (`"partially_refunded" | "fully_refunded"`) — so consumers can answer "is this payment whole?" in a single read. Both additions are optional/additive (no migration required).

**New `BetterStripe` methods:**

- `createRefund`, `getRefundByStripeId`, `listRefunds`
- `getDisputeByStripeId`, `listDisputes`, `updateDispute` (submit evidence), `closeDispute`

**New triggers/hooks:** `SyncTriggers.refund` / `SyncTriggers.dispute` (sync, same-transaction) and `AsyncHooks.onRefundCreated` / `onDisputeCreated` / `onDisputeClosed` (async, after-commit).

**Breaking (pre-1.0):** the internal `TriggerDispatcherName` / `AsyncHookName` unions grew (added `refundUpserted`, `disputeUpserted`, `afterRefundCreated`, `afterDisputeCreated`, `afterDisputeClosed`). Apps using the recommended `webhookHandlers()` + `webhooks: internal.stripe` wiring need **no changes** — the pair is unchanged and all trigger/hook fields are optional. No app-level migration is required.

Note: V2 `customer_account` + `pause_collection`/dispute interplay and the refund-via-API path are covered by unit tests; the live E2E (`refund.created` via real API call, dispute triggers) should be run before release — `charge.dispute.funds_withdrawn`/`funds_reinstated` cannot be reliably triggered in test mode.
