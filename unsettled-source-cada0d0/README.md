# Unsettled cost source verification

Source cada0d0255917a5b998ec2cbcb93c44f59e9de5e.

All 15 repository gates passed, coverage 72.3%. Nine focused backend tests pass. The example deploy succeeded. No UI changed.

The actual Stripe sandbox/deployed-example test used one isolated renewal seller. The first attempt stopped before payment creation while its recipient capability was pending. After provider verification became active, the same actor and durable operation identities were reused. Processing fee availability was also retried with the same keys.

Actual costs recorded: refund 88 minor units; immediate dispute 59 processing plus 1,500 dispute fee. Provider transactions matched the recorded costs. The disputed source had no storeSales row and no transfer to the seller from that charge. Its payment retained real seller-owned product/price bindings. The trial subscription was canceled, so no future monthly billing was left active. Sandbox accounting/audit objects remain inspectable.

Unit tests also exercise subscription payments lacking PaymentIntent metadata, the original invoice price after subscription metadata changes, mismatched invoice allocations, and product-owner rejection. The existing verified-sale settlement guard was not changed.

This fixes the immediate-dispute prerequisite only. The example ledger cutover, legacy collection preservation, combined funded/insufficient renewals and parent acceptance remain unfinished.

Harness repository paths were sanitized. Secrets were captured into process memory by Convex environment lookup, never displayed or stored. Replace the sample local repository path and isolated QA actor identifiers before attempting another run.
