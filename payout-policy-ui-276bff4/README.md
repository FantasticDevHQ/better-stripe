# Reusable payout policy UI evidence

Source: `276bff457080d01a979122776019fd623d2b40c7`, PR #206.

[Review video](ui-readable.webm) and [original capture](ui-full-resolution.webm).
The review copy removes the idle setup opening and empty browser-capture padding, then enlarges the viewport for readability. No tested UI actions or results were removed. `annotations.json` records setup, test starts and passing assertions. Screenshots show the same live sandbox application. `mobile.png` and `mobile-check.txt` verify 390px layout without document overflow.

Browser checks passed:
- Custom minimum Save remains disabled before explicit hold consent.
- Jordan's legacy account reports unsupported controls rather than saved settings.
- Maya's funded account reports reconciliation required without activating a policy.
- API and BetterStripe components tabs share the payout policy layout.
- Affiliate payout controls precede recovery history, in light and dark themes.
- Before/after Stripe balance-settings receipts show the existing three demo account schedules unchanged. The baseline was captured at the earlier PR revision 3c3e46b; the final observation is at 276bff4. The intervening code change only moved recovery history below the payout controls.

`provider-release.json` is a separate live Stripe sandbox test using the compiled current-head package and a separately named local Convex backend. Settings replay accepted equivalent threshold field order. Seller 599 + affiliate 400 stayed below the authorized 1000-cent minimum; 100 cents of liabilities reduced entitlement to 899; one additional affiliate cent qualified 1000. Previews created no payout. The automatic worker created exactly one 1000-cent payout; a duplicate stayed deferred and a post-paid preview showed no unpaid entitlement. The original weekly schedule was restored and the disposable recipient closed. This does not claim a cloud-cron invocation or live-money bank delivery.

`repository-gates.txt`: all 15 exact-head gates passed, coverage 77.0% lines, unchanged Shadscan 100 and existing budgets. `react-doctor.txt` reports no issues and score 89/100. Local codegen regeneration and example deployment passed. CI run 38766662588 has all required checks green; CI codegen reported structural-only validation because its deployment secret is not set.

Regression logs show settings replay and refresh invalidation failures before their fixes. The current repository suite covers native progress, consent and invalid amounts, pending retries, opt-out, other-currency preservation, scope binding, seller costs, and stale-assessment invalidation.

Limitations remain explicit: these seeded accounts exercised browser limitation paths, so successful browser activation/opt-out is not claimed here. Successful activation/restore/release is separately verified through package/provider and adapter tests. Full progress totals, browser activation/expiry/reset coverage, larger-account provider continuation/scalable claims and actual linked Dojo/Fumadocs adoption remain outstanding on BTS-171/BTS-172.
