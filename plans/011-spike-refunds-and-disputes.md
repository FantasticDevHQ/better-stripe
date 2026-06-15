# Plan 011: Design spike — refund and dispute tracking

> **Executor instructions**: This is a DESIGN SPIKE — the deliverable is a
> design document, **not code**. Do not modify any file outside the
> deliverable path. Follow the investigation steps, answer the listed
> questions with evidence, and write the design doc. If anything in the
> "STOP conditions" section occurs, stop and report. When done, update the
> status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- src/component/ src/client/webhooks/ src/client/utils/webhookEndpoints.ts`
> On significant drift, re-verify the "Current state" claims before writing.

## Status

- **Priority**: P3
- **Effort**: M (investigation + writing; implementation would be L)
- **Risk**: LOW (no code changes)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

The component tracks the full forward money flow — checkout sessions,
subscriptions, invoices, payments, payouts (8 domain tables) — but nothing
for money flowing **backward**: no refund or dispute tables, and the webhook
event constants (`src/client/utils/webhookEndpoints.ts`, 20 V1 + 12 V2
events) include no `charge.refunded`, `refund.*`, or `charge.dispute.*`
events (verified: `grep -n "charge\|refund\|dispute"` over that file returns
nothing). For the marketplace/Connect use case this component explicitly
targets, refunds and disputes are where platforms lose money silently: an app
that splits payouts on `payment_intent.succeeded` has no signal to reverse the
split when the payment is refunded or disputed. The architecture (ledger,
dispatchers, sync triggers, async hooks) makes this a pattern-following
extension — but the event-model questions below need answers before anyone
builds it.

## Current state (verified evidence)

- Domain tables: `accounts`, `products`, `prices`, `subscriptions`,
  `checkoutSessions`, `invoices`, `payments`, `payouts`, plus the internal
  `webhookEvents` ledger (`src/component/schema.ts` composes them from
  `core/`, `products/`, `billing/`, `connect/` schema files).
- The pattern a new domain follows, end to end (use `payouts` as the model —
  it's the smallest):
  1. fields + status validator: `src/component/connect/validators.ts`
  2. table + indexes: `src/component/connect/schema.ts`
  3. upsert mutation: `src/component/connect/mutations.ts`
  4. queries: `src/component/connect/queries.ts`
  5. event handling: `src/client/webhooks/processors.ts` (`handlePayoutEvent`)
  6. trigger dispatcher + async hook: `triggersApi()` in the client
     (`payoutUpserted`, `afterPayoutCompleted`) and the dispatch table in
     `src/client/webhooks/` (see `hooks.ts` / `handler.ts`)
  7. event constants: `src/client/utils/webhookEndpoints.ts`
  8. client facade methods: `src/client/connect/payouts.ts` + `src/client/index.ts`
  9. README: supported-events list, trigger interfaces, method tables

## Deliverable

ONE file: `plans/outputs/011-refunds-disputes-design.md` (in `plans/outputs/`,
create if absent). Sections:

1. **Event model investigation** (the heart of the spike — answer with
   sources): Stripe refunds surface as `refund.created`/`refund.updated` and
   `charge.refunded`; disputes as `charge.dispute.created`/`.updated`/`.closed`
   (and `.funds_withdrawn`/`.funds_reinstated`). Which exact set should the
   component subscribe to, given it tracks **payment intents** (not charges)
   today? How does a refund event reference back to the `payments` row —
   `refund.payment_intent`? Verify against SDK types
   (`node_modules/stripe/types/`) and note whether these are V1 snapshot
   events (they should be — confirm they're compatible with the existing
   snapshot destination so consumers only update `enabledEvents`, not create
   a third destination).
2. **Schema proposal** — `refunds` and `disputes` field lists with validators
   sketch, status unions (refund: pending/succeeded/failed/canceled; dispute:
   needs_response/under_review/won/lost — verify exact Stripe values),
   indexes (by stripe id, by payment intent id, by account id, plus
   status-compound indexes per Plan 002's lesson), and the link strategy to
   existing `payments` rows.
3. **Trigger/hook surface** — proposed additions: `refundUpserted`,
   `disputeUpserted` dispatchers; `onRefundCreated`, `onDisputeCreated`/
   `onDisputeClosed` hook names — and the impact on `triggersApi()`'s
   exported-name contract (it's a BREAKING change to the export list;
   reference how CHANGELOG.md's Unreleased block documented the previous
   trigger-contract break).
4. **Payment-status interplay** — should `charge.refunded` also patch the
   linked `payments` row (e.g. a `refunded`/`partially_refunded` flag), or is
   the refunds table the only record? Recommend one with reasoning.
5. **What is explicitly out** — Connect *transfer reversals*
   (`transfer.reversed`) and application-fee refunds: include or defer, one
   paragraph each.
6. **E2E verifiability** — which of these events `stripe trigger` can fire
   (check `stripe trigger --help` if the CLI is available; otherwise mark as
   open), so the implementation plan can extend
   `example/scripts/e2e-webhooks.ts`.
7. **Effort estimate** for the implementation plan (expect L) and a suggested
   split (refunds first, disputes second — they're independently shippable).
8. **Open questions for the maintainer.**

## Commands you will need

| Purpose | Command | Expected |
| ------- | ------- | -------- |
| SDK refund event types | `grep -rn "refund" node_modules/stripe/types/EventTypes.d.ts \| head -20` (adjust filename to actual SDK layout) | event name list to cite |
| Confirm current event list | `grep -c "v1\." src/client/utils/webhookEndpoints.ts; grep -n "EVENTS" src/client/utils/webhookEndpoints.ts` | the constants to extend |

## Scope

**In scope**: `plans/outputs/011-refunds-disputes-design.md` only (plus the index status row).

**Out of scope**: ALL source code. No schema edits, no event-constant edits.

## Steps

1. Read the payout vertical end-to-end (the 9 files listed in Current state)
   so the proposal mirrors real shapes, not idealized ones.
2. Investigate the SDK's event and object types for `Refund` and `Dispute`;
   confirm payload linkage fields (`payment_intent`, `charge`) and snapshot
   compatibility.
3. Write the deliverable.

**Verify**: deliverable exists; every Stripe-behavior claim cites an SDK type path or doc URL; section 1 explicitly answers the payment-intent-vs-charge linkage question.

## Done criteria

- [ ] `plans/outputs/011-refunds-disputes-design.md` exists with all 8 sections
- [ ] No source files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The SDK types contradict the assumption that refund/dispute events are V1
  snapshot events deliverable to the existing destination — that changes the
  whole design; report before writing a proposal around a third destination.

## Maintenance notes

- If the maintainer green-lights this, the implementation should be split
  into two plans (refunds, then disputes) and follow Plan 002's compound-index
  convention and Plan 006's error convention from day one.
- The `triggersApi()` export-contract break should ride the same release as
  any other breaking change (see Plan 009's pre-1.0 semver note).
