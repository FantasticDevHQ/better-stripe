# Maintaining release descriptions

Release Please reads a release PR's description when its normal release workflow
creates a tag. It needs standalone `---` lines around the version notes. Replacing
the description with review evidence can make a merged release PR unrecognizable,
skip publication and cause the existing automation to generate another release.
A successful workflow with a skipped Publish job does not establish publication.

Prefer PR comments for test logs, review evidence and acceptance updates. Keep the
generated description intact. When release notes need an editorial correction,
keep the exact candidate version, notes boundaries and existing checked acceptance
evidence. The local helper builds the description without writing to GitHub:

```sh
node scripts/release-description.mjs build 0.37.0 evidence.md CHANGELOG.md > release-body.md
node scripts/release-description.mjs check 0.37.0 release-body.md
```

Use the candidate's actual package version instead of the example version. The
helper selects only that version's changelog notes. It appends the supplied evidence
unchanged after the closing delimiter. It refuses missing notes, conflicting
version headings, HTML details/summary release selectors inside notes, and evidence
containing standalone separators, which would change
Release Please's parse boundaries. Resolve such input explicitly before updating a
PR. This local check supports a single-package release; it does not claim to parse
all Release Please formats.

Before changing a release PR description, save its current body and preserve all
reviewer acceptance and evidence. Run the local check again on the fresh remote
body after updating it. Do not replace a newer reviewed body with an older local
copy. Preserve the generated footer and any bot metadata. Independent acceptance
and the exact-head merge guard still apply. This helper does not merge, enable
auto-merge, create tags, invoke workflows or publish npm packages.

The 0.36 description incident demonstrated this failure. Its run skipped Publish;
the next generated 0.37 PR automatically merged before independent candidate
acceptance. Keep that timing distinction in the release evidence. Correct inaccurate
notes through an ordinary reviewed PR and complete the normal reviewed release and
public-artifact verification before application adoption. Never substitute a local
tarball, a workflow conclusion or a later audit for the required public artifact or
premerge acceptance.

## Compiled public exports

`pnpm build` compiles the package and runs `scripts/check-public-exports.mjs`
against the emitted public SDK, React and testing exports using Node's standard
ESM resolver. It performs no provider calls. Keep this check in the existing
build path: bundled source tests and successful Convex registration did not catch
the extensionless import exposed by the public SDK in 0.47.0. Use explicit `.js`
extensions for reachable relative imports; do not hide failures behind a custom
resolver. A corrected local build is candidate evidence; verify the normal
published artifact before application adoption.

## Release workflow

Releases are automated with [Release Please](https://github.com/googleapis/release-please-action) and published to npmjs.com as `@fantastic.dev/better-stripe`. **Don't bump the version or edit `CHANGELOG.md` by hand.**

1. **Give every PR a Conventional Commit title** (it becomes the squash-merge commit):
   - `fix: …` makes a patch release.
   - `feat: …` makes a minor release.
   - `feat!: …` (or a `BREAKING CHANGE:` footer) makes a minor release while the package is pre-1.0.
   - `docs:`, `chore:`, `ci:`, `refactor:`, `test:`, `build:` and `perf:` appear in the changelog too. On their own they still open a patch release PR, which auto-merges once its required checks pass.

   Write the title for consumers of the package: it becomes the changelog entry. A title that isn't a Conventional Commit is left out.

2. **On merge to `main`**, the `Release` workflow opens or updates a release PR that bumps `package.json`, `CHANGELOG.md`, the README version line and `.release-please-manifest.json`. It formats the generated changelog with the repository's pinned Prettier and commits any formatting changes through the release GitHub App, so CI validates the formatted branch. An already formatted changelog creates no extra commit. After formatting, the workflow enables squash auto-merge for the generated release PR using the release GitHub App.
3. **Auto-merge waits for green checks**. The active `main` ruleset requires `ci`, `Shadscan UI quality gate (100)` and `codegen`, with no bypass actors. Failed or pending required checks prevent merging. Once GitHub merges the generated release PR, the resulting `Release` workflow run tags the version, creates the GitHub release and publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers) with provenance. There's no npm token.

Release policy lives in `release-please-config.json`. Keep the workflow file named `release.yml`, because the trusted publisher on npmjs.com is bound to that filename. A manually pushed `vX.Y.Z` tag also publishes, but only if it matches `package.json` and `CHANGELOG.md` has a section for it (`scripts/release-notes.mjs`). If publishing fails after the GitHub release is created, use **Re-run failed jobs** on that run. Check npm first if the outcome is uncertain: a published version can't be overwritten.

The private `example` workspace isn't published.
