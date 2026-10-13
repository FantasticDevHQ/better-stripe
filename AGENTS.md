# Repository checks

Run `pnpm run check:all` before handing off changes. Fix failures without
weakening gate policy, lowering coverage or Shadscan floors, or raising existing
budgets. Repository policy is in `repo-gates.config.json`; baselines are in
`gates/`.
