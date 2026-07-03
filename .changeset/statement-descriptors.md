---
"@getdojo/better-stripe": minor
---

Add per-store statement descriptors on destination charges (BTS-32, #47).

- New `BetterStripe.setAccountStatementDescriptor` method (validates first; `null` clears) writes a `statementDescriptor` field on the component's account record via a new `core/mutations/setStatementDescriptor` mutation.
- New constructor option `statementDescriptorSuffix` sets a configurable platform-wide default (validated at construction, same pattern as `platformFee`), used whenever a store account carries no suffix of its own. Resolution order: store's stored suffix → configured default → none.
- Applied on every destination charge: one-time payment mode sets `payment_intent_data.statement_descriptor_suffix` at session creation; subscriptions (which can't carry a suffix directly) stash the resolved value as a `bsStatementDescriptor` metadata marker, applied by a new `applyStatementDescriptor` webhook processor.

Purely additive — no existing method signatures change.
