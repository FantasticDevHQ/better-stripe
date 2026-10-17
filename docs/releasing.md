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
