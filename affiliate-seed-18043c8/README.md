# Affiliate fixture funding regression

Code commit `18043c8`. A real isolated BetterStripe sandbox reset/reseed reached task 55/56, then failed its affiliate payout with insufficient funds. A fresh provider read confirmed Avery had zero available and pending balance, while both sample stores had funds. Fresh stores inherited zero commissions, so referred sales earned no affiliate money although the fixture attempted a $5 affiliate payout.

The fix explicitly configures 20% Forever commissions only when the fictional Maya/Sasha stores are first created. Ordinary store defaults remain zero. Existing stores, including edited or cleared rates, are untouched by seed reruns. No artificial affiliate funding is injected and no existing commission economics are rewritten.

The failing regression reproduces the zero setting, and all 24 seed/default tests pass after the fix. All 15 repository gates pass in 79.9 seconds, with 78.0% line coverage. Policies and budgets are unchanged.

`before-failure.png` and `before-failure.webm` show the actual failed browser fixture run. The video is the final 90-second excerpt; it is NOT a passing run. Initial setup used an older copied component, which was upgraded during that run; the seed implementation that caused zero commissions was byte-identical to the main source. A fresh all-current recorded Stripe reset/reseed is running and will be added before acceptance/merge. Do not infer final success or full financial lifecycle acceptance from the deterministic tests alone.
