# Stripe sandboxes for example worktrees

Use an account-owned Stripe sandbox for the full BetterStripe example. Each
worktree leases one sandbox exclusively. Ordinary library work does not need a
sandbox. The temporary sandbox probe found permission failures for Accounts v2,
Connect and payouts; its temporary keys cannot run the full example.

## Choose where the sandboxes belong

Keep BetterStripe development separate from sandboxes used by other projects.
Stripe documents a limit of five sandboxes per account. One slot supports one
leased example worktree, including a stopped worktree that retains its Stripe data.
Start with one slot; add a second for concurrent development and isolation testing.

For FantasticDev, first check the **organization** account picker. Stripe supports
an organization sandbox with new account sandboxes inside it. This can provide a
dedicated BetterStripe test environment without creating a new live account:

1. Sign in to Stripe and select the FantasticDev organization.
2. Open the account picker, then **Switch to sandbox → Create sandbox**.
3. Select **Create all new sandboxes**. Name the organization sandbox
   `BetterStripe development`.
4. Add an account sandbox named `betterstripe-dev-a`. Stripe also asks for its
   business location; use the location approved for your organization.
5. Create the sandbox, then open the account sandbox inside it.

The organization guide does not establish an increased quota for this option.
Check the options and quota shown by your Dashboard. If this option is unavailable
or does not provide the capacity you need, an organization administrator can
evaluate a dedicated BetterStripe account under FantasticDev. Confirm the account
structure with the administrator before creating another live account. Never
delete another project's sandbox to make room.

For an existing dedicated account, open **account picker → Switch to sandbox →
Create sandbox**, enter `betterstripe-dev-a`, and choose whether to copy the
account's settings. Copied settings can include capabilities required by Connect.
A blank sandbox may need additional product configuration. Confirm that the
Dashboard shows a sandbox banner before retrieving any keys.

Sources: [manage account sandboxes](https://docs.stripe.com/sandboxes/dashboard/manage)
and [manage organization sandboxes](https://docs.stripe.com/sandboxes/dashboard/organizations),
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
that sandbox's own key. Sharing a key under two names is rejected.

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

Webhook forwarding is delivered separately in **BTS-328**. Credential registration
and leasing alone do not start a listener or prove signed event delivery. Until
that service lands, do not treat successful backend startup as full example
readiness.

For a custom pool location, pass `--pool /absolute/private/path/sandboxes.json`
during registration and set `STRIPE_SANDBOX_POOL_FILE` to that same absolute path
for setup/start/release. All worktrees sharing sandbox accounts must use the same
pool and registry on one host. Copying the pool to another machine does not provide
cross-machine lease coordination.

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
