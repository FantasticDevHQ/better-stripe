# Repository checks

Run `pnpm run check:all` before handing off changes. Fix failures without
weakening gate policy, lowering coverage or Shadscan floors, or raising existing
budgets. Repository policy is in `repo-gates.config.json`; baselines are in
`gates/`.

# Release PR metadata

Keep Release Please's generated description and standalone notes delimiters intact.
Post review evidence in comments. When editing release notes, use the local
`scripts/release-description.mjs` build/check commands and preserve fresh acceptance
and evidence; see `docs/releasing.md`. Workflow success with Publish skipped is not
publication. Never replace a newer reviewed body with a stale local copy.

# Local worktrees and PRs

Use `pnpm worktree:setup`, then `pnpm worktree:start` for the example backend.
Use `pnpm worktree:stop` to preserve state and reservations, or
`pnpm worktree:teardown` to release reservations. Cleanup requires `--yes`.
Never copy cloud credentials or kill processes by port. See
`docs/worktrees.md` and `docs/pull-request-standard.md`.
On the shared agents host run focused checks with one worker and a 512 MB Node
heap; run the full required `pnpm run check:all` on UbiCloud CI.
