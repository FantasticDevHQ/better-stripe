# Opening collection verification

Source eef4d56239196c294f7832551b15e9d975faa238.

All 15 repository gates passed, coverage 72.6%. Twenty-three focused tests across four files passed, including signed opening collections, currency isolation, immutable replay after observations/collections, legacy invoice/payout holds, actor binding, legacy writer quarantine and chronological sales history across currencies. Deployment succeeded.

The public client was exercised against the deployed Convex component without a Stripe key. Two concurrent imports returned one claim; a later observation survived replay; altered snapshots/owners and imports into a pending boundary were rejected. The synthetic non-billable QA scope finished with zero outstanding/reserved amounts and no active group. This is bookkeeping evidence, not a Stripe payment test. No provider calls or real collections occurred.

The example adoption adapter is internal migration tooling. No active example stores were adopted in this verification. Full payout/invoice routing cutover and combined renewal acceptance remain open.

The harness is a sanitized copy with a placeholder repository path. It relies on an authenticated development Convex project; it uses no Stripe credentials. No UI changed, so API and log evidence applies.
