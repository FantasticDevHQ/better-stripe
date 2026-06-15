# Plan 012: Auto-publish to npm on merge to main (version-gated)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- .github/workflows/publish.yml package.json`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition. (Plan 009 intentionally changes
> `package.json`'s `publishConfig` and `version` — that drift is expected and
> fine; anything else is not.)

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: MED (a workflow bug here publishes to a public registry; publishes are not unpublishable after 72h)
- **Depends on**: plans/009-publish-readiness.md (publishConfig must be `public` and version/changelog resolved before the first automated publish can succeed)
- **Category**: dx / direction
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

The maintainer wants merges to `main` to release the package without a manual
publish step. Today `publish.yml` only runs when a GitHub **release** is
published — a manual ritual nobody has performed (the package has never been
published). A naive "publish on every push to main" would fail on every merge
that doesn't bump the version (npm rejects duplicate versions) and would turn
unrelated merges into accidental releases. The right shape is a
**version-gated** workflow: on push to `main`, publish only when
`package.json`'s version is absent from the npm registry, then tag and create
a GitHub release for the published version. Merging a version bump to main
*is* the release action; all other merges are no-ops.

## Current state

- `.github/workflows/publish.yml` (complete file as of `7cbbd55`):

```yaml
name: Publish

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
      - run: pnpm publish --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- `package.json`: name `@getdojo/better-stripe`; `publishConfig.access` is
  `"restricted"` until Plan 009 flips it to `"public"`; `prepublishOnly` runs
  clean + typecheck + build.
- `.github/workflows/ci.yml` runs typecheck/lint/test on PRs (to main, and to
  develop after Plan 001) — the publish job re-runs them anyway as a last gate.
- The package has **never been published**: `npm view @getdojo/better-stripe version`
  returns a 404/E404 today. The version-gate script must treat 404 as
  "not yet published → proceed".
- The `NPM_TOKEN` repo secret is referenced by the existing workflow; whether
  it is actually configured is NOT verifiable from the repo (see Step 5 and
  STOP conditions).

## Commands you will need

| Purpose | Command | Expected on success |
| ------- | ------- | ------------------- |
| YAML sanity | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/publish.yml'))"` | exit 0 |
| Registry check (read-only) | `npm view @getdojo/better-stripe version` | E404 today (package unpublished) |
| Local gate dry-run | the Step 2 script run locally | prints a publish/skip decision |
| Full suite | `pnpm typecheck && pnpm lint && pnpm test` | exit 0 |

## Scope

**In scope**:

- `.github/workflows/publish.yml` (rewrite)
- `README.md` — a short "Releasing" subsection (how a release happens now)
- `plans/README.md` status row

**Out of scope**:

- `package.json` — version/publishConfig belong to Plan 009; this plan must
  work with whatever version is current.
- `.github/workflows/ci.yml` — untouched.
- Adopting changesets/semantic-release — rejected for now (single package,
  manual CHANGELOG discipline already in place; see Maintenance notes).
- Actually publishing anything: this plan's verification never runs
  `pnpm publish` outside the workflow file, and the workflow only acts on
  push to `main`.

## Git workflow

- Branch: `advisor/012-auto-publish` off `develop`
- Conventional commits, e.g. `ci: version-gated npm publish on merge to main`
- Do NOT push, open a PR, or commit unless the operator instructed it.

## Steps

### Step 1: Rewrite the workflow triggers and add the version gate

Replace `.github/workflows/publish.yml` with:

```yaml
name: Publish

on:
  push:
    branches: [main]
  workflow_dispatch: # manual escape hatch / re-run

concurrency:
  group: publish
  cancel-in-progress: false # never kill a publish mid-flight

permissions:
  contents: write # create the release tag
  id-token: write # npm provenance

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
          registry-url: https://registry.npmjs.org

      - name: Check whether this version is already published
        id: gate
        run: |
          PKG_NAME=$(node -p "require('./package.json').name")
          PKG_VERSION=$(node -p "require('./package.json').version")
          PUBLISHED=$(npm view "$PKG_NAME@$PKG_VERSION" version 2>/dev/null || true)
          if [ "$PUBLISHED" = "$PKG_VERSION" ]; then
            echo "Version $PKG_VERSION already on npm — skipping publish."
            echo "publish=false" >> "$GITHUB_OUTPUT"
          else
            echo "Version $PKG_VERSION not on npm — will publish."
            echo "publish=true" >> "$GITHUB_OUTPUT"
          fi
          echo "version=$PKG_VERSION" >> "$GITHUB_OUTPUT"

      - if: steps.gate.outputs.publish == 'true'
        run: pnpm install --frozen-lockfile
      - if: steps.gate.outputs.publish == 'true'
        run: pnpm typecheck
      - if: steps.gate.outputs.publish == 'true'
        run: pnpm lint
      - if: steps.gate.outputs.publish == 'true'
        run: pnpm test
      - if: steps.gate.outputs.publish == 'true'
        run: pnpm build
      - if: steps.gate.outputs.publish == 'true'
        name: Publish to npm
        run: pnpm publish --no-git-checks --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # Deliberately NOT gated on steps.gate.outputs.publish: if a previous
      # run published but died before tagging, a rerun (workflow_dispatch)
      # skips the publish via the gate but still creates the missing tag here.
      - name: Tag and create GitHub release (idempotent)
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          VERSION="${{ steps.gate.outputs.version }}"
          TAG="v$VERSION"
          PKG_NAME=$(node -p "require('./package.json').name")
          # Only tag versions that are actually on npm (published by this
          # run or a prior one) — never tag an unpublished version.
          if [ -z "$(npm view "$PKG_NAME@$VERSION" version 2>/dev/null || true)" ]; then
            echo "Version $VERSION not on npm — nothing to tag."
            exit 0
          fi
          if [ -n "$(git ls-remote --tags origin "refs/tags/$TAG")" ]; then
            echo "Tag $TAG already exists — skipping."
            exit 0
          fi
          git tag "$TAG"
          git push origin "$TAG"
          gh release create "$TAG" --title "$TAG" \
            --notes "See CHANGELOG.md for details." || true
```

Notes that are load-bearing:

- The gate queries `name@version` specifically; for a never-published package
  `npm view` exits non-zero and `|| true` makes `PUBLISHED` empty → publish
  proceeds. Test this locally (Step 3).
- `concurrency.cancel-in-progress: false` queues a second merge behind an
  in-flight publish instead of killing it.
- `--provenance` requires the `id-token: write` permission and a public
  package; if the npm org rejects provenance on first publish, see STOP
  conditions before removing the flag.
- The old `release: published` trigger is intentionally dropped — the
  workflow now *creates* releases; keeping the old trigger would make it
  re-trigger itself (the `gate` would skip, but it's noise; `workflow_dispatch`
  covers manual reruns).
- `pnpm publish` runs the existing `prepublishOnly` (clean + typecheck +
  build) — the explicit build step before it is belt-and-braces, keep both.

**Verify**: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/publish.yml'))"` → exit 0.

### Step 2: Lint the workflow logic locally

Run the gate script body locally (it is read-only):

```bash
PKG_NAME=$(node -p "require('./package.json').name")
PKG_VERSION=$(node -p "require('./package.json').version")
npm view "$PKG_NAME@$PKG_VERSION" version 2>/dev/null || echo "NOT PUBLISHED (expected today)"
```

**Verify**: prints `NOT PUBLISHED (expected today)` (package has never been
published). If it prints a version, the package HAS been published since this
plan was written — re-read Plan 009's status before continuing.

### Step 3: Document the release ritual

Add a short "### Releasing" subsection to README (near the Status section
Plan 009 adds, or at the end of Configuration if 009 hasn't run):

> Merging to `main` publishes automatically **when `package.json`'s version
> is new to npm**: bump the version and update `CHANGELOG.md` in the release
> PR; merges without a version bump are no-ops for the registry. CI publishes
> with provenance and creates the matching `vX.Y.Z` tag and GitHub release.

**Verify**: `grep -n "Releasing" README.md` → 1 hit.

### Step 4: Full suite (unchanged code, but the gate for every plan)

**Verify**: `pnpm typecheck && pnpm lint && pnpm test` → exit 0.

### Step 5: Report the secrets checklist (no action possible from the repo)

End your report with this operator checklist (you cannot verify these):

- [ ] `NPM_TOKEN` repo secret exists, is an **automation** token (bypasses
      2FA), and has publish rights for the `@getdojo` scope.
- [ ] Plan 009 merged (publishConfig `public`, version `0.2.0`, changelog
      resolved) BEFORE the first version-bump merge to main.
- [ ] Optional: branch protection on `main` requiring CI green, so nothing
      reaches the publish workflow unreviewed.

## Test plan

Workflow files can't be unit-tested in this repo. The verification layers:

- YAML parse check (Step 1).
- Local dry-run of the gate logic (Step 2).
- The real test is operational and operator-driven: the first merge to main
  after this lands should be observed end-to-end (gate skips if no bump;
  publishes + tags on a bump). Recommend to the operator in your report:
  make the first publish deliberately, by merging Plan 009's version bump.

## Done criteria

- [ ] `publish.yml` triggers on `push: [main]` + `workflow_dispatch`, with the version gate, concurrency group, provenance, and tag/release steps
- [ ] Old `release: published` trigger removed
- [ ] Step 2's local gate dry-run behaves as documented
- [ ] README "Releasing" subsection exists
- [ ] `pnpm typecheck && pnpm lint && pnpm test` exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated; operator checklist included in the final report

## STOP conditions

Stop and report back (do not improvise) if:

- `publish.yml` no longer matches the excerpt (someone already changed the
  trigger model — reconcile intent first).
- `npm view @getdojo/better-stripe version` succeeds (package already
  published) AND Plan 009 is not marked DONE — version/state assumptions are
  off; reconcile before automating publishes.
- You are tempted to add `npm publish`/`pnpm publish` to any locally-run
  verification — never run publish locally; the workflow is the only publish
  path.
- Provenance requirements conflict with the npm org settings in a way you
  can't resolve from documentation — report; removing `--provenance` is an
  operator decision (it weakens supply-chain guarantees).

## Maintenance notes

- **Release flow after this lands**: bump `version` + CHANGELOG in the PR →
  merge develop → main → CI publishes, tags `vX.Y.Z`, creates the GitHub
  release. No manual npm or release-UI steps.
- **Why not changesets/semantic-release**: single-package repo with an
  existing hand-maintained CHANGELOG and deliberate-release culture
  (pre-1.0, breaking changes batched). Revisit changesets if the repo grows
  packages or contributor volume makes manual bumps error-prone.
- **Failure modes to watch in review**: a publish that succeeds but a tag
  push that fails leaves registry/repo briefly out of sync; rerunning via
  `workflow_dispatch` recovers it — the gate skips the publish and the tag
  step (intentionally NOT gated on the publish output) creates the missing
  tag. The tag step is fully idempotent: it exits early when the version
  isn't on npm or when the tag already exists, so reruns and no-op merges
  are safe. The `|| true` on `gh release create` covers only the release
  object (a tag without a release is cosmetic).
- Interacts with Plan 009: its STOP condition about auto-publish-on-branch
  is satisfied by this design (publishes only from `main`, only on version
  change).
