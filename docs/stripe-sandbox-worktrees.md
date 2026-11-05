# Stripe sandboxes for example worktrees

Use an account-owned Stripe sandbox for the full BetterStripe example. Each
worktree leases one sandbox exclusively. Ordinary library work does not need a
sandbox. The temporary sandbox probe found permission failures for Accounts v2,
Connect and payouts; its temporary keys cannot run the full example.

## Single-machine use only

**Worktree sandbox leasing works on one machine only.** The pool lock and lease
registry are local files. They do not coordinate leases between computers,
developers' machines, virtual machines or CI runners.

Keep a pool of **one to five sandbox test secret keys** on each machine that runs
the example. One key is enough for one leased worktree; five keys are optional.
Each key must belong to a different sandbox account. The pool is a list of keys
with account and lease metadata, stored as the `sandboxes` array in the private
pool file. The registration command maintains this array for you.

**Every additional machine needs a separate pool with different sandbox accounts
and keys.** This includes your other laptop, another developer's computer, and a
CI runner. Different keys for the same sandbox account do not provide isolation.
Do not copy a pool to another machine or register the same sandbox account on two
machines. Independent local registries could lease it at the same time and mix
Stripe objects and webhook events between backends.

The chosen key stays in the ignored `.worktree/backend.env` and is imported into
that worktree's local Convex environment. This file is local runtime configuration;
it is not distributed through Git or synchronized to other machines.

The current CI suite uses the synthetic bootstrap key. It verifies real local
Convex backend isolation, but does not run real Stripe operations. A future CI
job that exercises Stripe must receive a separate CI-owned pool through secure
credential delivery. Ephemeral or parallel runners cannot share the developer
pool: use separate sandbox accounts per runner, or add shared lease coordination
before sharing a pool across runners. That coordination is not implemented here.

The five-sandbox limit belongs to the parent Stripe account; creating a local pool
file on another machine does not create additional Stripe sandbox capacity.

## Choose where the sandboxes belong

Keep BetterStripe development separate from sandboxes used by other projects.
Stripe documents a limit of five sandboxes per account. One slot supports one
leased example worktree, including a stopped worktree that retains its Stripe data.
Start with one slot; add a second for concurrent development and isolation testing.
Only include sandboxes reserved for this machine. Other machines need separate
sandboxes and their own pools within the available account capacity.

Use a dedicated account named **Better Stripe** inside the **FantasticDev**
organization. Leave this account unactivated for live payments. Its account-owned
sandboxes supply the worktree pool.

The hierarchy is:

```text
FantasticDev organization
└── Better Stripe account (unactivated for live payments)
    ├── betterstripe-dev-a sandbox
    ├── betterstripe-dev-b sandbox
    └── up to five account-owned sandbox slots
```

1. Sign in to Stripe and select the FantasticDev organization.
2. Use the organization's account management flow to create an account named
   `Better Stripe`. Supply the business location approved for your organization.
3. Keep the account unactivated for live payments. Select the new account.
4. Open **account picker → Switch to sandbox → Create sandbox**.
5. Name the first sandbox `betterstripe-dev-a` and create it under Better Stripe.
6. Open the sandbox and confirm that the Dashboard shows a sandbox banner before
   retrieving any keys.

Add further account-level sandboxes as needed, up to the account's five-slot
limit. Keep the sandboxes used by other FantasticDev accounts unchanged. This
setup uses a dedicated account's sandbox capacity rather than an organization
sandbox container.

Stripe can copy account settings and capabilities into a sandbox. An unactivated
account may have incomplete settings; verify Accounts v2, Connect and payout test
flows in the new sandbox before considering the full example ready. The dedicated
account structure alone does not prove that each product capability is available.

Source: [manage account sandboxes](https://docs.stripe.com/sandboxes/dashboard/manage),
checked 2026-11-04. Dashboard options depend on your role and account configuration.

## Register the first sandbox

Inside the account sandbox, open the Developer Dashboard's API keys page. Reveal
its full **test secret key**, which starts with `sk_test_`. Use the key from this
specific sandbox, not its live parent or a shared test-mode workspace. The key's
prefix alone cannot prove which environment you selected.

Run this command from BetterStripe in an interactive terminal:

```sh
node scripts/example/sandbox-pool-cli.mjs register --name betterstripe-dev-a
```

Paste the test secret key into the hidden prompt. The command retrieves the Stripe
account ID, rejects duplicate accounts, and creates a private configuration file
for you. You do **not** need to write JSON, find an account ID, or supply a
publishable key. The current example uses server-side Checkout and does not need
a publishable key for this setup.

The default file is `~/.config/better-stripe/sandboxes.json`, under the operating
system user's home directory. This remains stable when the worktree runner gives
Convex an isolated HOME. The directory has mode `700`; credential and lease files
have mode `600`. They stay outside Git. A registration succeeds only after a
read-only API request confirms the account identity. This check does not prove
that every required product capability is configured; verify Admin Setup and the
example flows against the selected sandbox.

For agent-assisted setup, enter only the key into T3's private secret card. The
agent can consume its private file with:

```sh
node scripts/example/sandbox-pool-cli.mjs register \
  --name betterstripe-dev-a --key-file /absolute/path/from-private-delivery
```

Do not paste keys into chat, command arguments, screenshots, commits or logs.
The key file must be an owner-only regular file. The registration command does not
use an existing Stripe CLI login. See Stripe's
[sandbox key guide](https://docs.stripe.com/sandboxes/dashboard/manage-access).

To register a second sandbox, repeat these steps with `betterstripe-dev-b` and
that sandbox's own key. Repeat as needed for a pool of one to five keys; you do
not need to register all five. Sharing a key under two names is rejected. Before
registration, confirm that the sandbox is not assigned to another machine; the
local registration command cannot check another machine's pool.

## Use the example profile

Stop an already running worktree before setup:

```sh
pnpm worktree:stop
pnpm worktree:setup --profile example
pnpm worktree:start --profile example --frontend
```

The credential hook selects a free slot, verifies its key against the registered
account ID, and writes it into the ignored `.worktree/backend.env`. The runner
imports this file into the worktree's local Convex backend before the final push.
Repeated setup retains the same sandbox. Use the explicit profile when starting
the example so its lease guard runs. `setup --prepare-only` does not allocate a
Stripe lease because it does not run the pre-import phase.

If this backend already has a manually configured real key, registration must
include that same key before adoption. Setup refuses to replace an existing
account with a different pool slot. Keep its existing Stripe objects and Convex
IDs together.

Library-only `pnpm worktree:setup` runs no Stripe hook and retains the synthetic
bootstrap key behavior. The generic runner contains no Stripe-specific commands.
On the shared agents host, follow [the CI and resource rules](worktrees.md): the
required full gates and library build run on UbiCloud CI.

## Managed webhook listeners

Install the [Stripe CLI](https://docs.stripe.com/cli/install) before starting the
example profile. The listener flags were checked with CLI 1.55.6. If `stripe` is
not on PATH, set `STRIPE_CLI` to its absolute executable path. No Stripe CLI login
is required: the service uses the leased key and an explicit private CLI config.
Inherited Stripe account, key and API override variables are removed from listener
environments so they cannot select another sandbox.

`pnpm worktree:start --profile example --frontend` starts the local backend first,
then a managed `stripe` service, then the frontend. The service owns two foreground
CLI listeners: snapshot events and supported thin events. Both forward platform
and Connect events to `http://127.0.0.1:<reserved-site-port>/stripe/webhook`.
Snapshot forwarding uses `--all-snapshot`. Thin forwarding explicitly selects
Accounts v2 account, configuration, identity, requirement, person and account-link
events, plus the two billing meter error types supported by the handler. It does
not subscribe to all V1 resource thin events. The selected event names are in
`scripts/example/stripe-listeners.mjs`.

The service captures each listener's signing secret privately. It updates
`STRIPE_WEBHOOK_SECRET` and `STRIPE_WEBHOOK_SECRET_V2` in `.worktree/backend.env`,
then imports only these two values into the same local Convex backend. Private
listener state is in `.worktree/stripe-listener/` with owner-only permissions.
Raw CLI output and signing secrets are not printed to the supervisor log.

Readiness is published only after both listeners have reported their secrets and
the Convex import succeeds. The readiness probe checks the worktree ID, lease,
service PID and supervisor PID against current runner state; an old marker cannot
satisfy a different service process. Startup is bounded. A missing CLI, failed
import or required-listener exit fails the named service and stops its siblings.
Use `pnpm worktree:start --profile example` when preparing the first service start.
The runner retains the service profile, so plain start after stop resumes these
services too. The service rechecks the lease on every start, even when the runner
does not rerun the explicit beforeStart hook.

`pnpm worktree:stop` stops both owned listeners and removes readiness while retaining
the sandbox lease and private configuration. Restart reuses the same sandbox and
imports the current listener secrets again. Repeated start while the supervisor is
active reuses it. These controls do not create Dashboard webhook destinations or
delete remote Stripe resources.

Fixture tests verify local process ownership, import ordering, failure handling,
restart and separate worktree secrets. They do not establish successful real Stripe
delivery or Admin Setup. Verify signed snapshot, thin and Connect events and the
example's seed/test flows against your chosen sandbox before calling that sandbox
ready for full example use. See the [CLI listener reference](https://docs.stripe.com/cli/listen)
and [thin event types](https://docs.stripe.com/api/v2/core/events/event-types).

For a custom pool location, pass `--pool /absolute/private/path/sandboxes.json`
during registration and set `STRIPE_SANDBOX_POOL_FILE` to that same absolute path
for setup/start/release. All worktrees sharing sandbox accounts must use the same
pool and registry on one host. A different path does not add cross-machine lease
coordination. Keep this pool and its sandbox accounts exclusive to this machine.

## Retention and recovery

`worktree:stop` retains both local data and the Stripe lease. `worktree:teardown`
releases local port reservations but retains that lease. Local cleanup also does
not release a remote sandbox. These rules prevent another worktree from inheriting
Stripe objects while the old backend still holds their IDs.

When no slots are free, setup reports pool exhaustion. Stop/start does not free a
slot. Add another sandbox within your available capacity, or arrange an explicit
recovery with the pool owner. Do not delete the lease registry to bypass exhaustion.

To retire a lease, run these commands **before** removing the worktree's local state:

```sh
pnpm worktree:stop
node scripts/example/sandbox-pool-cli.mjs release
```

Release quarantines the slot. It does not erase Stripe data or make the slot
available to another worktree. The old worktree cannot acquire a replacement
automatically. This initial implementation does not provide a recycle command.
Keep quarantined entries until an operator has a reviewed recovery procedure
that resets the sandbox, rotates its keys, and reconciles old Convex object IDs.

If a key is revoked, an account is deleted, or pool metadata changes, restore the
original association before retrying. Do not replace its account ID or delete
`.worktree/stripe-lease.json` to force a fresh lease. A partial local write can retry
against the globally reserved owner. API verification failures do not import keys.

If setup reports a pool lock timeout, first confirm that no registration or setup
process is still using this pool. An interrupted process can leave
`sandboxes.json.lock`; only after that check may the pool owner remove this empty
lock directory. Keep `sandboxes.json` and `sandboxes.json.leases.json` intact.
