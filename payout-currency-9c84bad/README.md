# Payout currency display evidence

Source commit `9c84badd717b2f95110af18a72f5b7d976d7ffc9`.

The example previously displayed 100 JPY units as ¥1. The failing example regression reproduces it. The corrected example uses the exported `formatPayoutAmount`, shared with native package Payouts and PayoutHistory. Supported units are preserved, including fractional ISK compatibility balances. Unsupported precision remains explicit raw minor units, including KWD, rather than guessing or crashing.

Six focused example/package tests pass. React Doctor reports no changed-file issues, score 92/100. Full gates are being verified before PR handoff.

`ui.webm` is a continuous Playwright browser recording of the actual source package Payouts using synthetic observed balances. Four assertions passed with no page errors: JPY, fractional ISK, unsupported precision, refresh/mobile. The 1440x1000 viewport and 390px mobile screenshot show the package's unstyled native markup. This is a presentation fixture, not a Stripe sandbox payout, full example backend, or bank delivery test. Example page rendering is covered separately by the regression test.

No credential, customer data, or financial operation is included. No claim is made that this currency fix completes the remaining payout acceptance or Dojo integration.
