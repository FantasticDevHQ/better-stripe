# BTS-138 balance funding verification

Source commit aca7c2d48783308175d3b547097232128446bfd3.

- All 15 repository gates passed, coverage 70.0%; no policy/budget changes. 18 focused tests cover provider operations, actual serialized preview headers and phase keys, host durable retries and the React consent workflow.
- Example backend pushed successfully. Only balance-funding calls use an explicitly selected preview client; normal example/client defaults remain GA.
- Real deployed example + real Stripe sandbox: funded $9 USD monthly renewal used stripe_balance, debited once and stayed active. Retrying a paid invoice caused no extra debit.
- Insufficient available USD balance produced insufficient_funds, paid zero, debited zero, closed expired store access, and did not charge the saved card.
- Opt-out restored the exact previous default payment method and method types. Repeated opt-out was safe. Re-enabling created a new durable operation identity; a second opt-out restored the original settings again.
- Test subscriptions canceled afterward. Existing old snapshot receiver inherited an unpinned version; replaced with an explicitly pinned 2026-09-30.endive receiver, updated signing secret privately, disabled old receiver. Thin destination unchanged.
- No visible UI/layout change; backend logs, provider results and sanitized harnesses are evidence. No new UI video.

## Remaining combined cost fixture failure

The original combined refund/dispute renewal script timed out before renewal because the immediate test dispute was already disputed when guarded sale settlement ran. It correctly refused a new transfer; the missing store-sale record then prevented dispute cost reconciliation. Refund costs were recorded. This is documented on BTS-139 and must be addressed with BTS-139/BTS-140 before claiming combined cost renewal acceptance. The passing renewal harness verifies balance funding only; it does not substitute for that remaining cost scenario.

No production traffic. Credentials and private merchant/fixture identifiers omitted. Harnesses are sanitized review copies using placeholder paths; they are not standalone runnable fixtures.
