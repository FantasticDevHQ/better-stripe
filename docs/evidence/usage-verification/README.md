# Native usage verification refresh

On 2026-10-18, the existing BetterStripe Stripe sandbox was read through the
example's authorized package adapters for all six archived customer/seller model
fixtures. Each call used the existing Convex development deployment. No new
payment, credit grant, usage event, cancellation or transfer was created.

`native-refresh.json` retains each fresh native aggregate observation, subsequent
package snapshot and complete paginated ledger result. The original invoice and
cash evidence remains in `../usage-example/native-results.json`; it is intentionally
identified as retained financial proof, not a fresh observation of cash.

The retained capture runner accepts only a `dev:` deployment and a manifest of
these six synthetic original fixtures. It uses the existing authorized Convex CLI
session and public example adapters; it needs no secret values in its arguments.
To refresh from the repository root, with access to that development deployment:

```sh
node scripts/capture-usage-verification.mjs docs/evidence/usage-verification/fixtures.json docs/evidence/usage-verification/native-refresh.json
```

Use your own manifest of original fixture IDs for another development deployment.
Never substitute production data or reuse these IDs as a production authorization
policy. Native adapters recheck actor/run ownership and sandbox configuration.

Audit the retained results from the repository root:

```sh
node scripts/verify-usage-evidence.mjs
```

Expected result:

```json
{
  "models": 6,
  "tolerance": "0 scaled units",
  "cash": "original paid source only",
  "renewal": "future allowance unavailable"
}
```

The audit compares exact original prices/items/periods and effective units with
zero scaled-unit tolerance; matches original paid amounts and processing fees;
and checks original cash/transfer identities and conservation of gross. It rejects
unknown, stale or incomplete evidence. The accompanying test suite intentionally
corrupts these fields and proves rejection.

The [full acceptance matrix](../../usage-verification.md) maps fault injection,
packed-consumer behavior, native eligibility and unsupported clock/live-money
cases. The existing [continuous UI recording](../usage-example/native-flows.mp4)
shows all three settled example outcomes. No new UI flow changed in this
verification layer, so that recording is reused with its original capture context.
