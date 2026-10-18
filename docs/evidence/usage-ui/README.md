# Package usage UI verification

Environment: localhost deterministic fixture at
`scripts/fixtures/usage-ui.html`, branch `codex/bts-258-usage-react`.
The PR evidence identifies the exact reviewed commit. These captures do not
execute Stripe calls, native payments, production changes or business work.

[Annotated step video](annotated-steps.mp4) presents the seven captured browser
states with selectable assertion subtitles. It is a time-compressed screenshot
step recording, not continuous screen video. The original full-page PNGs retain
readable text; [annotations](annotations.json) record capture timestamps and
assertions. The fixture supplies styling; the package components remain unstyled.

All captured assertions passed:

1. [Pay as you go](01-payg-delayed.png): local 14 units and unknown delivery are
   separate from stale partial native aggregation of seven units and estimates.
2. [History page two](02-history-page2.png): bounded cursor navigation shows the
   second row without executing work.
3. [Included usage](03-included-overage.png): ten included, 14 consumed and two
   reserved units show four committed overage units, estimates and a soft warning.
4. [Pending purchase](04-prepaid-pending.png): no new units are granted by the
   pending purchase; existing consumption, exhaustion and unavailable application
   proof remain separate.
5. [Held credits](05-prepaid-held.png): frozen quantities and recovery are visible;
   credit consumption is not another cash collection or withdrawable money.
6. [Tenant change](06-tenant-reset.png): local quantity changes to three and history
   resets to page one.
7. [Unavailable](07-unavailable.png): failed evidence is displayed as unavailable,
   never as an empty or zero bill.

Co-located tests additionally cover delayed old responses after identity, tenant,
meter, period and currency switches, mismatched estimate currencies, out-of-range
date displays, empty/cyclic cursors, keyboard-accessible retry and shared
component/API-adapter layouts. Native financial end-to-end acceptance is tracked
separately in BTS-261.
