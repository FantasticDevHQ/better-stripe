# CLAUDE.md — better-stripe

## What this is

`@getdojo/better-stripe` is a reusable Convex component for the Stripe V2 Accounts API.

- Library in `src/`:
  - `src/client/` — app-facing `BetterStripe` class and method implementations
  - `src/component/` — Convex functions and schema (the installable component)
  - `src/react/` — React hooks and components
  - `src/testing/` — fixtures and test helpers
- Demo app in `example/` (Vite + React + Convex).

## Commands

- Library: `pnpm typecheck`, `pnpm lint`, `pnpm test` (vitest), `pnpm build`
- Example app: `pnpm --filter ./example run build` (also `lint`, `typecheck`)
- Note: the example resolves `@getdojo/better-stripe` from `dist/`, so run `pnpm build` once in a fresh checkout before building the example.

## E2E webhooks

`pnpm --filter ./example run e2e:webhooks` — requires an authenticated Stripe CLI and a linked Convex dev deployment. Not CI-runnable. Run it before releases; it has caught real bugs that unit tests can't.

## Branches

- `develop` is the working branch; `main` is the release branch. PRs go to `main`.
- Never switch branches mid-session.

## Rules

- Never commit without being told to commit.
- Tests accompany every change.
- `plans/` holds advisor-written implementation plans — read `plans/README.md` before starting one.

## Known sharp edges

- V2 thin events are verified via `parseEventNotificationAsync`, not `constructEventAsync` — stripe-node v22 rejects thin payloads with the latter.
- `userId: ""` is the unattributed-record sentinel, not a bug.
- Sync triggers run in the same transaction as component upserts; a throw rolls back both.
