# Renewal preservation mappings

The internal renewal projection modules convert selected, bounded provider read
fields into explicit schedule update fields. They are not public schedule writers.
Every successful field projection carries `requiresProviderQualification: true`.
It is not permission to attach or configure a schedule, evidence of provider
retention, or a complete phase. See the [renewal contract](renewal-price-replacements.md).

The aggregate assembler must take these fields from the full acknowledged owned
schedule, bind that baseline and its unchanged defaults, and correlate original
subscription, customer account, item, price, quantity, period and target. It must
derive effective collection method, tax enablement and invoice issuer from those
reads and defaults. Context inputs are comparison values, not provenance flags.
A browser cannot supply this evidence.

## Phase settings

`projectRenewalPhaseSettings` accepts only the named phase fields below. Unknown
fields at this boundary reject. Expanded references must have the expected object
and resource ID kind and cannot be deleted. Available mode and customer facts,
including nested Customer facts, must agree with context. Bare IDs preserve a
reference from the acknowledged scoped read; they do not prove ownership or
resource freshness by themselves.

| Read field                | Projected update field              | Rule                                                                                                                                                                                                     |
| ------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application_fee_percent` | omitted                             | Only null supported. Nonnull, including zero, rejects for this platform flow.                                                                                                                            |
| `billing_thresholds`      | omitted                             | Only null supported. Active thresholds can change the paid period.                                                                                                                                       |
| `collection_method`       | same                                | Null omits. Otherwise require the exact effective known method.                                                                                                                                          |
| `default_payment_method`  | ID                                  | Null omits. Validate available customer/account/mode facts. Never translate a legacy source.                                                                                                             |
| `on_behalf_of`            | account ID                          | Null omits. No inferred routing or scope change.                                                                                                                                                         |
| `transfer_data`           | destination ID, optional percentage | Null omits. Preserve numeric zero and percentages with at most two decimal places; reject extra precision without rounding. Null percentage omits that subfield. Never invent 100.                       |
| `automatic_tax`           | enabled, optional liability         | Absent omits. Preserve false. Null liability omits; self has no account, account liability requires its exact ID. Nonnull disabled reasons reject. Compare effective enablement with unchanged defaults. |
| `default_tax_rates`       | ordered tax-rate IDs                | Null/absent omits; empty list becomes provider Emptyable `""`. Expanded rates must match mode. Nonempty manual rates with effective automatic tax reject.                                                |
| `description`             | same                                | Null omits. Preserve strings including empty strings exactly.                                                                                                                                            |
| `metadata`                | exact string map                    | Null/empty map omits actions. Empty-value unset actions reject. Never derive phase actions from flattened subscription metadata.                                                                         |

Invoice settings map only `account_tax_ids`, `custom_fields`, `days_until_due`,
`description`, `footer` and `issuer`. Null settings or null nested overrides omit.
Empty tax-ID/custom-field lists use `""`; nonempty lists retain order. Text retains
empty strings. Days require effective `send_invoice` and a bounded nonnegative
integer. Issuer must agree with effective issuer. Expanded invoice tax IDs require
self/account ownership matching that issuer. Customer/application owners, missing
owner evidence and deleted references reject. These identify the issuer, not the
buyer.

Omitting a null override relies on the unchanged default hierarchy. This mapper
does not establish that hierarchy or authorize replacing defaults. The assembler
must reject unknown or contradictory defaults. Provider parameter types alone do
not establish that a read-to-write mapping preserves provider behavior.

## Item settings

`projectRenewalItemSettings` maps item `tax_rates` and metadata. Thresholds must be
null. Null/absent tax override omits; explicit empty rates becomes `""`; nonempty
expanded rates map in order after mode/deletion validation. Effective automatic
tax rejects manual item rates, including tax inherited from schedule defaults.
Metadata follows the phase action rules. Item identity, price, quantity and
successor correlation belong to the full assembler and observer. This projection
does not assume item IDs survive a price transition.

## Existing discount redemptions

`projectRenewalDiscounts` emits only `{discount: existingId}`, never coupon or
promotion-code selectors that would redeem again. It requires a direct existing
subscription/item redemption, exact account/owner correlation, matching ordered
phase references, an expanded coupon with forever duration and null redemption
end, and product applicability covering original and target. Coupon and product
IDs may be custom nonblank identifiers. Generated resource kinds such as `di_`,
`sub_`, `si_` and `acct_` remain validated.

Phase references must be IDs or minimal undeleted reference objects. Full expanded
phase Discount objects require normalization and correlation first; contradictory
extra claims reject. Coupon references must agree with the expanded source.

Once/repeating duration, ancestor-owned redemption, ambiguous empty discount
hierarchy and missing source evidence remain unsupported. Null end alone does not
establish forever duration. Customer `discount: null` proves current absence only.
It does not distinguish historical suppression from inheritance or authorize
freezing future customer discounts. These required consumer contexts remain open
in the full contract. No invented provenance flag or host policy replaces them.

## Complete-request requirements

The full preflight/assembler still owns trial/cancellation/pending/special state,
original/target identity, current/future boundaries, anchor/cadence classes, full
receipt/default/request bindings and drift rejection. Subscription-only payment
or historical trial fields without phase writers are retention-verification gaps,
not proof Stripe discards them. An extra subscription POST, rollback or release
cannot hide such a gap.

Provider qualification, dispatch and observation remain separate requirements.
The complete flow must prove unchanged paid terms and the exact renewal outcome,
including supported month-end/cadence behavior, before capability acceptance.
