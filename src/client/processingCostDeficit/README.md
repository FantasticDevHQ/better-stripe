# Processing-cost deficit

`calculateProcessingCostDeficit` is a pure SDK calculation. The host authorizes
the original same-currency source and explicitly chooses liability and rounding.
The helper creates no charges, claims or transfers. The example's existing
business policy stays in the host until its financial cutover.

All amounts use nonnegative safe integer API ledger units. Gross must be positive
and the original inclusive selling fee cannot exceed gross. Currency must have
supported package charge-currency metadata. Metadata does not establish account,
country or payment-method eligibility. This helper does not convert display
amounts or validate a provider-specific charge/transfer quantum.

Required policy fields:

- `liability.processingCosts: "uncovered"` subtracts the proportional retained
  inclusive selling fee from processing costs and floors the liability at zero.
- `"all"` assigns all processing costs; `"none"` assigns none.
- `liability.disputeCosts: "all" | "none"` selects dispute-cost liability
  independently. Actual credited costs should be resolved before calling.
- `rounding: "nearest" | "floor" | "ceil"` applies to the retained fee.
  Nearest rounds a positive exact half up. No policy has a default.

The calculation caps overlapping refunded/disputed principal at original gross.
It returns normalized currency, retained fee, processing liability, dispute
liability and total `amountDue`. Unsafe input amounts or totals are rejected.

The old example formula's ordinary fixtures use processing `"uncovered"`,
disputes `"all"` and rounding `"nearest"`. USD, JPY, ISK and UGX fixture values
retain their historical integer-unit results. Multiplication and division now
use exact integers. At gross 9007199254740991, selling fee 9007199254740990 and
returned principal 3002399751580330, retained fee is exactly 6004799503160660.
The old floating-point intermediate incorrectly rounded it to 6004799503160661.
This correction intentionally preserves a one-unit liability that the old
formula lost. No host calculation changes until its caller adopts this API.
