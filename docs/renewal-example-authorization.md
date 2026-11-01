# Renewal authorization in the example app

The existing `example/` app is the host for renewal component integration tests.
Its renewal authorization queries require `ctx.auth.getUserIdentity()` and reuse
the authenticated billing-history actor lookup. Exactly one buyer or customer
must map to the identity's `tokenIdentifier`. Missing identity, ambiguous mappings
and other persona roles reject.

The example UI still uses unauthenticated demo personas. Choosing a persona does
not authenticate a request or grant renewal permission. These queries demonstrate
an opt-in authenticated host boundary; they do not configure a production identity
provider or implement a consent flow.

## Fixed query capabilities

All four functions are internal queries in
`example/convex/renewalAuthorization/queries.ts`:

| Query           | Permission and exact scope                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `observe`       | Installation, attachment and configure operation IDs, plus the server-owned platform/account/mode, customer-account, subscription and schedule scope.  |
| `invoices`      | An independent invoice permission for the same operations, complete provider scope including Customer ID, and the exact original/current invoice pair. |
| `retainWitness` | An independent retention permission for the complete witness identity, provider scope, configure request binding, observed item and native period.     |
| `readWitness`   | An independent read permission for that immutable scope and the exact stored witness row and payload digest.                                           |

The query arguments contain operation/resource selectors, never a caller-chosen
user ID or authorization snapshot. The authenticated subject is resolved by the
host. Base observation does not imply invoice, retention or read permission.
Retention does not imply later read permission.

The returned snapshots match the SDK's fixed query contracts. Base observation
omits Customer ID, while invoice and witness scopes include it. Authorization
IDs, revisions and expiry timestamps come from the retained permission records
and are returned unchanged. A query never creates a sliding expiry.

## Trusted permission records

`renewalOperationGrants` and `renewalWitnessGrants` are indexed host-owned tables.
Their indexes include the authenticated user and exact operation or witness
selection. The query reads at most two matching rows. Duplicate detection occurs
before expiry or revocation checks, so a revoked duplicate cannot hide an
ambiguous permission record.

Each record also retains the original `tokenIdentifier`. Remapping a user row to
another subject does not transfer an existing grant. Each capability has its own
authorization ID, positive safe-integer revision, safe-integer expiry and
revocation flag. Missing, revoked, expired or malformed permission refuses.
Witness-read permission additionally binds the exact row ID and versioned
SHA-256 payload binding.

This example increment supplies no public grant-issuing endpoint. The controlled
tests insert permission rows through trusted `convex-test` setup. Such fixtures
exercise query behavior; they do not prove real consent or production grant
issuance. An actual application must issue and revoke grants under its own
authenticated authorization policy.

## SDK and component integration

The SDK reauthorizes through the fixed query and compares complete snapshots.
A single query cannot detect a revision change that happens later. The example
integration tests change the revision or provider scope between actual query
calls and verify that the SDK refuses the changed authorization.

The controlled round trips use the example schema and registered BetterStripe
component, actual example authorization queries, maintained private SDK capture
and historical-read consumers, complete invoice context and optional configure
acknowledgement. They verify separate retention/read permission and full stored
witness identity. Provider responses and grant issuance in these tests are
controlled fixtures.

Production SDK profiles remain empty. Ordinary tests establish neither serving
deployment compatibility nor provider qualification, payment, entitlement,
public delivery or Dojo adoption. Native/backend and provider testing require
their separately approved windows and use this same example app.
