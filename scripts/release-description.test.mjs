import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  releaseDescription,
  validateReleaseDescription,
} from "./release-description.mjs";

const changelog =
  "# Changelog\n\n## [0.36.0](https://example.com/compare) (2026-10-17)\n\n### Fixes\n\n- Immutable original seller.\n\n## [0.35.0](https://example.com/previous)\n\n- Prior release.\n";
const evidence =
  "## Acceptance criteria\n\n- [x] Reviewed exact candidate.\n\nProof https://github.com/example/repo/pull/1#issuecomment-2\n";

describe("release description maintenance", () => {
  it("rejects the demonstrated custom body without Release Please separators", () => {
    expect(() =>
      validateReleaseDescription(
        "Review proof\n\n## [0.36.0]\n\n- Fix.\n\n" + evidence,
        "0.36.0",
      ),
    ).toThrow();
  });

  it("preserves exact release notes and checked review evidence in separate parseable sections", () => {
    const body = releaseDescription(changelog, "0.36.0", evidence);
    expect(body).toContain(
      "---\n\n## [0.36.0]\n\n### Fixes\n\n- Immutable original seller.\n\n---\n",
    );
    expect(body.endsWith(evidence)).toBe(true);
    expect(body).not.toContain("Prior release");
    expect(validateReleaseDescription(body, "0.36.0")).toBeUndefined();
  });

  it("refuses a missing changelog version without substituting the current version", () => {
    expect(() => releaseDescription(changelog, "0.37.0", evidence)).toThrow();
  });

  it("rejects a body for a different exact version", () => {
    expect(() =>
      validateReleaseDescription(
        releaseDescription(changelog, "0.36.0", evidence),
        "0.35.0",
      ),
    ).toThrow();
  });

  it("rejects a second release heading inside the release notes", () => {
    const body = releaseDescription(changelog, "0.36.0", evidence).replace(
      "- Immutable original seller.",
      "- Immutable original seller.\n\n## [0.37.0]\n\n- Conflicting release.",
    );
    expect(() => validateReleaseDescription(body, "0.36.0")).toThrow();
  });

  it("refuses evidence separators that would change Release Please's notes boundary", () => {
    expect(() =>
      releaseDescription(
        changelog,
        "0.36.0",
        evidence + "\n---\nMore evidence",
      ),
    ).toThrow();
  });

  it.each([
    "<details><summary>0.99.0</summary>Different release</details>",
    "<DETAILS open><SUMMARY>0.99.0</SUMMARY>Different release</DETAILS>",
    "<details\n open><summary>other-package: 0.99.0</summary>Different release</details>",
  ])("rejects nested release selectors in notes: %s", (nested) => {
    const injected = changelog.replace("- Immutable original seller.", nested);
    expect(() => releaseDescription(injected, "0.36.0", evidence)).toThrow();
    const body = releaseDescription(changelog, "0.36.0", evidence).replace(
      "- Immutable original seller.",
      nested,
    );
    expect(() => validateReleaseDescription(body, "0.36.0")).toThrow();
  });

  it("preserves HTML review evidence outside the notes section", () => {
    const proof =
      evidence +
      "<details><summary>0.99.0 prior proof</summary>Review history</details>\n";
    const body = releaseDescription(changelog, "0.36.0", proof);
    expect(body.endsWith(proof)).toBe(true);
    expect(validateReleaseDescription(body, "0.36.0")).toBeUndefined();
  });

  it("rejects empty notes and malformed version selectors", () => {
    expect(() =>
      releaseDescription("## [0.36.0]\n\n", "0.36.0", evidence),
    ).toThrow();
    expect(() => releaseDescription(changelog, "0.36", evidence)).toThrow();
  });
});

describe("release description command", () => {
  it("builds and checks a local file without changing its review evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-description-"));
    try {
      const notes = join(dir, "CHANGELOG.md");
      const proof = join(dir, "evidence.md");
      const output = join(dir, "body.md");
      writeFileSync(notes, changelog);
      writeFileSync(proof, evidence);
      const built = spawnSync(
        process.execPath,
        ["scripts/release-description.mjs", "build", "0.36.0", proof, notes],
        { encoding: "utf8" },
      );
      expect(built.status).toBe(0);
      expect(built.stdout).toContain(evidence);
      writeFileSync(output, built.stdout);
      const checked = spawnSync(
        process.execPath,
        ["scripts/release-description.mjs", "check", "0.36.0", output],
        { encoding: "utf8" },
      );
      expect(checked.status).toBe(0);
      expect(checked.stdout).toContain("parseable exact-version");
      const mismatch = spawnSync(
        process.execPath,
        ["scripts/release-description.mjs", "check", "0.35.0", output],
        { encoding: "utf8" },
      );
      expect(mismatch.status).toBe(1);
      expect(mismatch.stderr).toContain("exact selected version");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("fails explicitly on an unsupported mode instead of outputting a replacement body", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/release-description.mjs", "publish", "0.36.0", "evidence.md"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage:");
  });
});
