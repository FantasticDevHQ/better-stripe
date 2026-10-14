# BTS-146 durable recovery ledger verification

Source 9b520e76a600c5421da5216ebc10feebcaf8f052.

- All 15 repository gates passed in 90.9 seconds, coverage 70.9%. No gate policy, floors or budgets changed. Twelve focused tests passed, including a real component through the public client without provider I/O.
- Real Convex component tests cover immutable source economics and scope/currency binding; stale and conflicting observations; 126 claims with an unseen credit and exact maintained totals; bounded reservations and group-wide budgets; concurrent external boundaries; replay/release/collection; source credits during and after sealing; positive/negative partial refund rollback; paginated history; and reset inclusion.
- Development component deployed. Two concurrent CLI requests for distinct recovery boundaries produced exactly one reservation. Replay retained the same reservation. Repeated collection did not duplicate bookkeeping. A subsequent signed credit reconciled to zero amount due/collected/reserved/outstanding, with no pending boundary. Stale replay did not regress it.
- Deployed test used a non-billable QA account/scope and simulated approved amounts. No Stripe/provider calls or money movement. Closed QA audit rows remain with zero obligation. This does not claim invoice attachment or actual cost recovery integration, which remain BTS-147/BTS-148.
- Official Convex codegen generated the component bindings; drift check passed. Codegen command now runs from the configured example app to avoid the CLI's synthetic missing-root resolution failure. No hand-authored generated API fields.
- No visible UI/layout change. Backend logs and API output are the evidence; no new video.

Sanitized harness is a review copy with a placeholder repository path. No credentials or private merchant data included.
