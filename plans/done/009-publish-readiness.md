# Plan 009: Make the package publishable (npm readiness pass)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- package.json CHANGELOG.md README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (metadata/docs; no runtime code)
- **Depends on**: plans/002, 003, 004, 006 SHOULD land first (they change public behavior/error shapes — publish after, not before). Hard dependency: none.
- **Category**: direction
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

The README's stated goal is a component "for anyone to use in their Convex
apps", and the codebase is feature-complete and E2E-tested — but the package
is not installable: `publishConfig.access` is `"restricted"`, the changelog's
breaking changes sit in an unresolved "Unreleased" block, `"main"` points at a
file that doesn't exist, and there's no signal to adopters about stability or
how this relates to `@convex-dev/stripe`. This plan prepares everything up to
— but not including — the actual `npm publish`, which only the operator runs.

## Current state

- `package.json` (root):
  - line 51: `"main": "index.js"` — no such file exists; the `exports` map
    (lines 21–50) is the real entry surface (`./dist/client/index.js` etc.).
  - lines 112–114: `"publishConfig": { "access": "restricted" }`.
  - `"files": ["dist", "src"]` — shipping `src/` alongside `dist/` is a
    deliberate Convex-component convention (the component's `convex.config`
    and `_generated` are consumed from source by the consumer's bundler in
    some setups) — **verify against what `@convex-dev/stripe` ships before
    changing anything here; default is leave as-is.**
  - `"version": "0.1.0"`, `"prepublishOnly": "npm run clean && npm run typecheck && npm run build"`.
- `CHANGELOG.md` — `## Unreleased` block with Breaking / Added / Fixed /
  Changed sections (the trigger-system rework, listPayouts rename, etc.),
  followed by `## 0.1.0` ("Initial extraction from Dojo monorepo").
- `README.md` — comprehensive; has no project-status section and no
  comparison/migration note relative to `@convex-dev/stripe` (which it cites
  as the convention source in its intro).
- `.github/workflows/publish.yml` exists — read it in Step 1 to learn how
  publishing is actually triggered (tag? release? manual dispatch?) so the
  release steps below match it.

## Commands you will need

| Purpose       | Command                                | Expected on success |
| ------------- | -------------------------------------- | ------------------- |
| Build         | `pnpm build`                           | exit 0, dist/ populated |
| Pack preview  | `npm pack --dry-run`                   | exit 0; file list shows dist/, src/, README, LICENSE?, CHANGELOG |
| Full suite    | `pnpm typecheck && pnpm lint && pnpm test` | exit 0          |

## Scope

**In scope**:

- `package.json` (publishConfig, main field)
- `CHANGELOG.md` (resolve Unreleased into a versioned release)
- `README.md` (status section + relation-to-@convex-dev/stripe note)

**Out of scope**:

- Running `npm publish` or pushing tags — operator-only actions.
- `.github/workflows/publish.yml` edits (read-only reference; if it's broken,
  report, don't fix here).
- The `files` array, unless Step 2's pack dry-run reveals something shipping
  that must not (e.g. test files bloating the tarball is acceptable; secrets
  or env files are a STOP).

## Git workflow

- Branch: `advisor/009-publish-readiness` off `develop`
- Conventional commits, e.g. `chore: prepare package metadata for first public release`
- Do NOT push, open a PR, commit, tag, or publish unless the operator instructed it.

## Steps

### Step 1: Read the publish workflow

Read `.github/workflows/publish.yml`. Note in your report: what triggers it,
what registry/auth it uses, and whether it respects `publishConfig`. Adjust
nothing.

**Verify**: you can state the trigger in one sentence.

### Step 2: Fix package metadata

In root `package.json`:

1. Change `"main": "index.js"` → `"main": "./dist/client/index.js"` (legacy
   resolvers only; `exports` wins in Node 12+).
2. Change `"publishConfig": { "access": "restricted" }` →
   `{ "access": "public" }`. (Scoped packages default to restricted —
   without this, the first publish of `@getdojo/better-stripe` fails or
   lands private.)

Then build and inspect the tarball:

**Verify**: `pnpm build && npm pack --dry-run` → exit 0; the listing contains
`dist/client/index.js`, `dist/component/convex.config.js`, `README.md`,
`CHANGELOG.md`; it contains NO `.env*` files and nothing matching
`*secret*`/`sk_test_`/`sk_live_` (`npm pack --dry-run 2>&1 | grep -i "env\|secret"` → no hits).

### Step 3: Resolve the changelog

Rename `## Unreleased` → `## 0.2.0 — 2026-06-11` (use the current date), and
bump `"version"` in `package.json` to `0.2.0`. Rationale to preserve: the
Unreleased block contains breaking changes relative to 0.1.0, so it must not
ship as a patch. Add a fresh empty `## Unreleased` heading above it.

**Verify**: `head -5 CHANGELOG.md` → shows `## Unreleased` then `## 0.2.0`; `node -e "console.log(require('./package.json').version)"` → `0.2.0`.

### Step 4: README status + positioning section

Add a short section near the top of `README.md` (after the intro paragraph),
~8 lines:

- **Status**: pre-1.0 (`0.2.0`); API may change between minor versions; used
  in production by its authors; webhook pipeline covered by unit tests and a
  live E2E harness.
- **Relation to `@convex-dev/stripe`**: this component targets the Stripe
  **V2 Accounts API** (Connect/marketplace-first) with a transactional
  trigger system; `@convex-dev/stripe` targets classic Customers/V1. They are
  different data models — there is no automated migration; choose by API
  generation. (Keep it factual; do not write marketing claims about being
  "better".)

**Verify**: `grep -n "Status" README.md | head -3` → the new section exists.

### Step 5: Full suite

**Verify**: `pnpm typecheck && pnpm lint && pnpm test` → exit 0.

## Test plan

No unit tests — metadata and docs. The pack dry-run in Step 2 is the
substantive verification.

## Done criteria

- [ ] `publishConfig.access` is `"public"`; `main` points at a real file
- [ ] `npm pack --dry-run` clean (no env/secret-looking files; entry points present)
- [ ] CHANGELOG has a dated 0.2.0 release and a fresh Unreleased heading; package.json version matches
- [ ] README has the status/positioning section
- [ ] `pnpm typecheck && pnpm lint && pnpm test` exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated — and note in it that plans 002/003/004/006 should merge before the operator actually publishes

## STOP conditions

Stop and report back (do not improvise) if:

- `npm pack --dry-run` includes anything secret-looking — report the filename
  (never its contents).
- `publish.yml` auto-publishes on push to a branch you'd be working on —
  report before changing `publishConfig` (changing access could make the next
  CI run publish publicly).
- The operator has not confirmed the package NAME `@getdojo/better-stripe` is
  final — prior session notes say it is, but if any in-repo signal contradicts
  it, ask.

## Maintenance notes

- The actual release ritual after this plan: operator merges fix plans →
  merges this → tags per `publish.yml`'s trigger → publishes. Document
  whatever Step 1 found about the trigger in your report.
- Pre-1.0 semver: breaking changes bump the minor. Revisit a 1.0 commitment
  once plans 010/011 (API surface direction) are decided — cutting 1.0 before
  adding pause/resume or refunds would make those breaking-adjacent.
