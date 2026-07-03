---
"@getdojo/better-stripe": patch
---

Fix: collect the fixed/tier platform fee on a subscription's first invoice (BTS-68, #52).

`applyPerInvoiceFee` (BTS-51) applies a fixed/tier `application_fee_amount` at `invoice.created`, which only works while the invoice is still a draft. Stripe finalizes a `charge_automatically` subscription's first invoice synchronously at creation (and Checkout subscription-mode pays it during checkout), so `invoice.created` fires with an already-`open` invoice — the update is silently rejected and the first cycle's platform fee was lost on every destination-charge subscription with a fixed/tier fee. Percent-only fees and renewal invoices (which get Stripe's ~1h draft window) were unaffected.

Fixed with a new `applyFirstInvoiceFee` processor hooked at `invoice.paid`: it collects the missed fee via a partial reversal of the automatic destination transfer, sized from `amount_paid` — the same mechanism BTS-60's `applyPerChargeFee` uses for one-time charges. Skips any invoice whose fee the draft path already collected, so there's no double-collection. No public API change.
