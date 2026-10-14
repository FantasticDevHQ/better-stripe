# BTS-137: upcoming invoice previews

Source commit: d23c594225ace850419f610e0c3936c494c3d03a.

- All 15 repository gates passed; no budgets or floors changed.
- Focused tests cover customer/subscription ownership, complete pagination, Stripe error identity, integer amounts/currency, configured GA/preview version, example cost policy and React server-total rendering.
- Real Stripe sandbox, explicit 2026-09-30.preview, isolated real Convex component test store. No production traffic or charges.
- Public API returned all 26 lines while Stripe embedded only 10; authoritative total/amount due 3400 USD minor units preserved. Provider next-payment timestamp returned in milliseconds. Wrong customer rejected before preview.
- Pending invoice items deleted, trial canceled, price and product archived afterward.
- Example backend pushed successfully to existing development deployment.
- Existing layout unchanged; backend logs and API output are evidence for this change. No new UI video.

The red logs show the missing API and unmigrated adapter before implementation. Merchant identifiers, credentials and local paths are omitted.
