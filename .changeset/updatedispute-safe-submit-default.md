---
"@getdojo/better-stripe": minor
---

`updateDispute` now stages evidence by default instead of submitting it (BTS-61).

Stripe's dispute-update `submit` parameter **defaults to `true`**, so evidence sent without an explicit `submit` is submitted to the bank — a one-shot, outcome-affecting action. The previous docblock incorrectly said omitting `submit` "saves a draft", and the method forwarded `submit` only when explicitly set, so a caller following the docs would submit unintentionally.

**Behavior change:** when `evidence` is provided **without** an explicit `submit`, `updateDispute` now sends `submit: false` (stages a draft). Callers must pass `submit: true` to finalize and submit to the bank.

- A bare metadata/status update (no `evidence`) is unchanged — no `submit` is forced.
- An explicit `submit: true` / `submit: false` is always honored.
- `EvidenceForm` (BTS-54) already passes `submit` explicitly, so it is unaffected.

If you relied on the old behavior of submitting evidence by omitting `submit`, pass `submit: true` explicitly.
