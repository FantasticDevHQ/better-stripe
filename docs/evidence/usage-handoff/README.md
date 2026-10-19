# Packed usage release handoff

The candidate was built and packed, then extracted into an isolated temporary
consumer. The native check imports the extracted `/convex.config` entry point,
installs its component under the original `betterStripe` name, and runs real
Convex code generation against the existing development deployment. The supported
bundler analyzes the packed component and nested runtime. Strict TypeScript then
checks the actual generated component against the public SDK and usage methods.

`packed-native-wiring.json` records the candidate version, archive SHA-256,
non-secret development selection, successful CLI stages and generated binding
checks. Its dependencies reuse the repository's pinned graph through symlinks;
the BetterStripe source itself comes from the extracted tarball, not a source
alias. Separate packed tests load public root/usage/React/testing exports and
compile the documented model/provisioning/reservation/purchase recipes.

Code generation analyzes component definitions; it does not replace the serving
application or execute its financial actions. No application data migration,
revision activation, usage send, payment or transfer was requested. After analysis,
the original example's native included-usage reader remained available, complete
and exactly 15 units.

Reproduce from the repository root, using your own authorized development
selection and output path:

```sh
pnpm run build
node scripts/verify-packed-usage-wiring.mjs dev:YOUR-DEVELOPMENT-DEPLOYMENT output.json
pnpm exec vitest run scripts/usage-contracts-packed.test.mjs scripts/usage-composition-packed.test.mjs scripts/usage-models-packed.test.mjs scripts/packed-docs.test.mjs scripts/public-docs.test.mjs
pnpm run check:all
```

The runner accepts only a `dev:` selection, reads no Stripe secret values, and
removes its temporary consumer. It rejects ambient deployment-key/token and
self-hosted overrides before running commands, sets the requested development
selection explicitly, and uses a fresh host with no inherited dotenv files. Existing authenticated Convex CLI access and the
server's configured required environment references are needed. Do not use an
unrelated deployment. The native probe is an explicit developer verification
step, not a credential-dependent ordinary unit test.

The [native model evidence](../usage-verification/README.md) and
[actual all-model UI recording](../usage-example/native-flows.mp4) retain their
original capture contexts. No UI behavior changes in this documentation layer.
This is reviewed source/candidate evidence, not proof of npm publication or
authorization for a release merge, production deployment or live billing.
