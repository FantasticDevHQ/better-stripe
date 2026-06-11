# Plan 001: Run CI on the develop branch

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7cbbd55..HEAD -- .github/workflows/ci.yml`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `7cbbd55`, 2026-06-11

## Why this matters

The repo's CI workflow only triggers on pushes and pull requests targeting
`main`, but day-to-day development happens on `develop` (e.g. PR #4 — a
38-commit audit-remediation branch — merged into `develop` with zero CI runs).
Type errors, lint failures, or test regressions can land on the active branch
and only surface much later when a release PR targets `main`. This plan is the
verification gate for every other plan in this directory, so it goes first.

## Current state

- `.github/workflows/ci.yml` — the only test/lint/typecheck workflow. Lines 3–7:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

- The CI job itself (pnpm install → `pnpm typecheck` → `pnpm lint` → `pnpm test`)
  is correct and should not change.
- There is also `.github/workflows/publish.yml` — out of scope.

## Commands you will need

| Purpose   | Command          | Expected on success |
| --------- | ---------------- | ------------------- |
| Validate YAML | `node -e "require('js-yaml')"` is NOT available — use `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` | exit 0 |
| Local equivalent of CI | `pnpm typecheck && pnpm lint && pnpm test` | exit 0 |

## Scope

**In scope** (the only file you should modify):

- `.github/workflows/ci.yml`

**Out of scope**:

- `.github/workflows/publish.yml` — release workflow, separate concern.
- Any change to the CI steps themselves (node version, caching, commands).

## Git workflow

- Branch: `advisor/001-ci-on-develop` off `develop`
- Commit message style: conventional commits, e.g. `ci: run checks on develop branch` (matches repo history like `chore(example): lint+typecheck coverage for scripts`)
- Do NOT push or open a PR unless the operator instructed it.
- Do NOT commit unless the operator instructed it (repo owner's standing rule: never commit without being told).

## Steps

### Step 1: Add develop to both triggers

Edit `.github/workflows/ci.yml` lines 3–7 to:

```yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
```

**Verify**: `python3 -c "import yaml; print(yaml.safe_load(open('.github/workflows/ci.yml'))['on'])"` → prints a dict where both `push` and `pull_request` have `branches: ['main', 'develop']`.
(Note: PyYAML parses the unquoted key `on` as boolean `True`; if the above prints `None`, use `['push']` lookup via `list(yaml.safe_load(...))` to confirm the structure instead — the file content is what matters.)

### Step 2: Confirm the checks pass locally

**Verify**: `pnpm typecheck && pnpm lint && pnpm test` → all exit 0 (this is exactly what CI will now run on develop).

## Test plan

No new tests — this is workflow config. The verification is the local run of
the same three commands CI executes.

## Done criteria

- [ ] `.github/workflows/ci.yml` contains `branches: [main, develop]` under both `push` and `pull_request`
- [ ] `pnpm typecheck && pnpm lint && pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `ci.yml` no longer matches the excerpt above (someone already changed the triggers).
- The local `pnpm typecheck && pnpm lint && pnpm test` run fails — that means develop is currently red and the failure must be reported, not patched in this plan.

## Maintenance notes

- If the repo later adopts feature-branch CI (e.g. `branches: ['**']`), this change is subsumed.
- Reviewer should confirm no branch-protection rules assume CI only runs on main.
