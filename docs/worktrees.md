# Local example worktrees

Installed from FantasticDevHQ/convex-worktrees commit
`52c0b76d960a98afedd48607d6737bc14a954c1e` using its Node installer.
The upstream MIT license remains in `scripts/worktree/LICENSE`.
The repository uses pnpm 10.32.1; the backend and Vite frontend both live in
`example/`. The layout prepareCommand builds the local library before each
schema push because the example imports its compiled dist exports. On the shared
VPS this build must run in UbiCloud CI rather than locally. This is not a Turborepo and requires no package relocation.

Run `pnpm worktree:setup`, `pnpm worktree:start` (optionally `--frontend`),
`pnpm worktree:stop`, `pnpm worktree:teardown`, `pnpm worktree:cleanup --yes`,
or `pnpm worktree:prune`. Stop keeps reservations and data; teardown releases
reservations and keeps data; explicit cleanup removes owned local state.
Setup fetches origin's live default (currently main) and refuses dirty or
divergent checkouts. New worktrees use the immutable fetched commit; adoption
must land on that base before new-worktree setup can use these commands.

The layout adapter is `scripts/worktree.config.json`. Local frontend adaptations
use Vite with strict ports and VITE_CONVEX_URL. The adapter seeds a deliberately synthetic `sk_test_` key for schema validation,
sets FRONTEND_URL to the reserved frontend port, and permits only the declared
STRIPE_SECRET_KEY missing-variable failure on first bootstrap. The final push
must succeed after seeding. The error adapter supports Convex 1.46 typed
MissingEnvironmentVariables messages as well as the upstream legacy text.
No Stripe credentials are copied;
external Stripe operations require separate sandbox configuration and are not
proven by the local isolation suite. Never use production credentials here.

Run `pnpm test:worktree` and `pnpm test:pr-standard` for focused tests.
Full `pnpm run check:all` runs on UbiCloud CI. Shared agents must serialize
installs and real backend integration with
`flock -w 3600 /home/cloudagent/.cache/fantastic-heavy.lock`, limit Node heaps to
512 MB, and use one test worker. Mac compatibility is unverified.

For upgrades, clone upstream outside the checkout, read its Quick start and
agent instructions, run `node scripts/check.mjs`, and reconcile every exported
module/test against the recorded commit. Preserve the Vite adapter, pnpm policy,
LICENSE, safe freshness behavior and ownership checks. Re-run focused and real
backend tests. The root `scripts/worktree.mjs` is an upstream compatibility shim.

## Temporary Stripe sandbox capability probe

Run this explicit developer probe before adopting temporary sandboxes for the
example. It does not change worktree setup/start, the example's Convex environment,
or its test-key guards. It is not a production credential provisioning command.

Install the [Stripe CLI](https://docs.stripe.com/cli/install). The probe was tested
with version 1.55.6 and uses `--all-snapshot` for snapshot forwarding. Set
`STRIPE_PROBE_CLI` to an absolute executable path if `stripe` is not on PATH.
Configure your intended email in `git config user.email`: Stripe uses it for the
temporary sandbox claim flow. The probe never claims a sandbox or logs in.

```sh
node scripts/example/probe-sandbox.mjs
```

First execution provisions one sandbox through `sandbox create --from-git
--non-interactive`. The CLI profile and credentials stay in the ignored
`.worktree/stripe-probe/` directory. Existing `STRIPE_*` variables are removed
from CLI child environments, so an inherited login/key cannot select another
account. An existing config without saved probe credentials causes a failure.
Subsequent executions reuse the saved association. The CLI documents a seven-day
expiry; the probe checks the returned expiration and refuses expired state.

The probe makes real **test-mode** requests for Accounts v2, a Connect recipient,
a customer, a Checkout session, a subscription, a transfer and a payout. It starts
owned, temporary CLI listeners and an ephemeral loopback HTTP collector to verify
snapshot and thin event signatures. It also looks for signed Connect events.
The collector does not forward events into the example database. Permission
failures and unobserved events remain failures, not inferred successes. A transfer
is blocked if recipient creation fails. A created Checkout session does not prove
that a browser payment completed. A thin V1 resource event does not prove V2
account event support. Review the event types in the report.

Only the sanitized report prints to stdout. It is also saved as
`.worktree/stripe-probe/report.json`; keep raw CLI output, keys, claim links and
hosted Checkout URLs private. Publish sanitized evidence in PR/Linear comments,
not as committed logs. The adoption decision stays blocked when any capability,
required event, cleanup operation or existing example test-key guard fails.

Successful subscriptions are canceled, Checkout sessions expired, transfers
reversed, cancelable payouts canceled and event probe products archived. Cleanup
failures are reported. Other test objects remain until sandbox expiry. Do not
delete saved state to retry a transient failure: reuse the same sandbox. For an
expired association, retain any needed sanitized report, then explicitly remove
only this disposable probe directory before provisioning again. This probe never
replaces the example's remote IDs or deletes remote accounts.

Focused regression tests use fixtures, not external credentials:

```sh
TMPDIR="$PWD/.worktree/tmp" NODE_OPTIONS=--max-old-space-size=512 pnpm exec vitest run --project scripts --maxWorkers=1 scripts/example
```

## Required CI contexts

`Repository quality gates` requires successful full check:all, Shadscan, codegen
and standalone Node test jobs. Failure, cancellation or skipping any dependency
fails the aggregate. The original `ci` status remains available.
`Real app backend isolation` runs two real example backends. Both use UbiCloud
Linux. `PR standard` is the commit status published by the metadata enforcer,
which executes only trusted base code with its write token. That context becomes
available only after the workflow and scripts land on base. The coordinator
configures required statuses after activation; merging this PR does not itself
change branch protection. Preserve existing required checks and review policies.
