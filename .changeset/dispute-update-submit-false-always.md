---
"@getdojo/better-stripe": patch
---

Fix: `updateDispute` now sends an explicit `submit: false` on every call, including metadata-only updates (BTS-72, #67).

BTS-61 made evidence-bearing `updateDispute` calls stage by default (`submit: false`), but left metadata-only updates sending no `submit` key at all — inheriting Stripe's server-side default, which Stripe's docs state is `true` on every update. Empirically, a metadata-only update does not submit previously staged evidence today, but that leniency contradicts the documented default and submission is one-shot and outcome-affecting. `updateDispute` now never omits `submit`: every call — evidence, metadata, or both — sends an explicit `submit: false` unless the caller passes `submit: true` to finalize.

No public API change; the safer default only ever narrows behavior (no call that previously submitted now stages, and vice versa).
