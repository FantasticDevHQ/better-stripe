# Official 0.10.2 release verification

Release PR: https://github.com/FantasticDevHQ/better-stripe/pull/144

Candidate: `d3b6375014d35ad1b01bac9db545d8b4843e3847`. Merge/tag source: `b5e08e99477a85b604bcd44fb8c0e617e610583f`.

Candidate CI passed all 15 gates plus separate Shadscan 100 and codegen:
https://github.com/FantasticDevHQ/better-stripe/actions/runs/38571092281

The four-file release diff updates package version, README version, release manifest and changelog consistently. Changelog formatting and release-note extraction passed. The included source fix has live non-Connect checkout/billing/portal/refund and signed-webhook evidence in the sibling `live-nonconnect` folder.

Official trusted-publishing run:
https://github.com/FantasticDevHQ/better-stripe/actions/runs/38571664968

The official workflow succeeded. npm registry metadata and its `latest` tag resolve to **0.10.2**. [Registry metadata](registry.json) includes the signed provenance URL. The [decoded provenance](provenance.json) identifies the expected repository, `.github/workflows/release.yml`, and merge commit `b5e08e99477a85b604bcd44fb8c0e617e610583f`.

A fresh isolated consumer installed exactly `@fantastic.dev/better-stripe@0.10.2` from npm with zero audit vulnerabilities. Runtime checks passed for GA/preview versions, inherited webhook registration, invalid-version rejection, React Payouts export and the actual compiled portal-cancellation fix included in the installed package. See [runtime results](consumer-runtime.json), [runtime check](consumer-runtime-check.mjs), and [install log](consumer-install.log).

The [consumer TypeScript contract](consumer-contracts.ts) passed with `tsc --ignoreConfig --noEmit --skipLibCheck --strict --module NodeNext --target ES2022`. All **15/15 local repository gates passed** at the formatted release candidate, with unchanged policies and 69.7% line coverage. See [local gates](local-gates.log). Candidate CI and the official tagged-package publish checks also passed.

The registry briefly returned 404 while npm processed the accepted publication. Verification continued until the exact version could be installed. No credentials or merchant data are included here.
