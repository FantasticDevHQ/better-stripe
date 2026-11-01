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
