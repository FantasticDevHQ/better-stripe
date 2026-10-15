# Release auto-merge retry evidence

Source: 2f2651832de309fd123329997b4d13dce1068816.

- The actual workflow failure was `expected head oid does not match the current head oid (enablePullRequestAutoMerge)` in https://github.com/FantasticDevHQ/better-stripe/actions/runs/38689772508 after formatting advanced the release PR head.
- 25 focused tests pass, including simulated stale-head rejection then success, three-attempt limit, unrelated/API failures, generated branch/base/repository checks, branch identity across retries, invalid inputs, closed/merged states and workflow integration. Red logs document missing behavior and the additional branch-pin regression before implementation.
- All 15 repository gates pass on the final rebased source, coverage 73.6%. No gate floors, budgets or policy changed.
- The tested helper enabled/merged actual release PR 174 after its exact-head CI passed. That invocation preceded the additional branch-pin guard; final-source replay recognized the already-merged release without another merge call. Real stale-head rejection is from the original workflow; retry-success handling is deterministic unit evidence, not a claim of a forced remote race.
- Official release workflow https://github.com/FantasticDevHQ/better-stripe/actions/runs/38690247912 passed and published 0.17.0 with provenance. Direct npm metadata verified version and latest tag after cache propagation.

Only internal automation changed; no UI flow is affected. Logs contain no credentials.
