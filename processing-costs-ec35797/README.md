# BTS-139 processing-cost context verification

Source ec35797f1d99a1670c125e7e82aa1834444b61eb.

- All 15 repository gates passed, coverage 70.3%. No policy or budget changes. 21 focused tests passed across provider math, actual SDK pagination/version/direct-account headers and the example adapter.
- Read-only public API handles cumulative partial refunds, signed fee credits, failed refund reversals, won/lost disputes, missing data and currency isolation. Source-linked transactions retain raw amounts; economic principal is capped without discarding raw overlapping debits. Fee breakdowns expose processor/application fee distinctions. No application debt or money movement.
- Real non-Connect Stripe sandbox with explicit preview version: 101 successful one-cent refunds retrieved completely, original processing fee 320 USD minor units and all provider totals preserved; millisecond dates verified. Remaining pagination-charge principal refunded afterward.
- Real immediate test disputes read without paying/settling disputed sales. Submitted winning/losing test evidence; both finalized. Won returned principal to zero, lost retained 1000 USD minor units. Actual dispute fee remained 1500 in both cases; net fees 1559. No assumed fee credit.
- Public client did not access component queries/mutations. Transport tests prove GET-only operations and complete next-page requests with the selected version and connected namespace.
- Example backend deployed. Its provider-read adapter uses the package; existing app-owned billing policy and missing-settlement guard remain. Combined cost claim/renewal fixture repair remains tracked for BTS-140; this is not claimed complete here.
- No UI/layout change; logs and API output are the evidence, with no new video.

The sanitized harness is a review copy with placeholder merchant/path values, not a standalone runnable script. Test fixture writes set up provider scenarios; the package cost method itself only reads. No production traffic or credentials included.
