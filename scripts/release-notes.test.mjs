import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { releaseNotes } from "./release-notes.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Release Please prepends its sections above the Changesets-era history.
const changelog = `# Changelog

## [0.4.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.4.0...v0.4.1) (2026-09-27)


### Bug Fixes

* keep the refund ledger in step ([#130](https://github.com/FantasticDevHQ/better-stripe/issues/130))

## 0.4.0

### Minor Changes

- Add getAccountBalance.

## 0.2.0 — 2026-06-11

- Earlier release.
`;

describe("releaseNotes", () => {
  it("reads a Release Please section up to the next heading", () => {
    expect(releaseNotes(changelog, "0.4.1")).toBe(
      "### Bug Fixes\n\n* keep the refund ledger in step ([#130](https://github.com/FantasticDevHQ/better-stripe/issues/130))",
    );
  });

  it("reads a Changesets section and a dated hand-written section", () => {
    expect(releaseNotes(changelog, "0.4.0")).toBe(
      "### Minor Changes\n\n- Add getAccountBalance.",
    );
    expect(releaseNotes(changelog, "0.2.0")).toBe("- Earlier release.");
  });

  it("refuses a version the changelog does not describe", () => {
    expect(releaseNotes(changelog, "0.5.0")).toBeNull();
  });

  it("does not match a prefix or a version that differs only at a dot", () => {
    expect(releaseNotes(changelog, "0.4")).toBeNull();
    expect(releaseNotes(changelog, "0.4.10")).toBeNull();
    expect(releaseNotes("## 0x4y0\n\n- no", "0.4.0")).toBeNull();
  });

  it("finds the current package version in CHANGELOG.md", () => {
    const { version } = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    );
    const notes = releaseNotes(
      readFileSync(join(packageRoot, "CHANGELOG.md"), "utf8"),
      version,
    );
    expect(notes, `CHANGELOG.md has no section for ${version}`).toBeTruthy();
  });
});
