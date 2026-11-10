import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import {
  internalIssuePrefixes,
  internalReferencePattern,
} from "./internal-references.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const listFiles = (...pathspecs) =>
  execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...pathspecs,
    ],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
const violationsIn = (files) => {
  const violations = [];
  for (const file of new Set(files)) {
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch (error) {
      // Tracked but deleted in the working tree.
      if (error.code === "ENOENT") continue;
      throw error;
    }
    text.split("\n").forEach((line, index) => {
      if (internalReferencePattern.test(line))
        violations.push(`${file}:${index + 1}`);
    });
  }
  return violations;
};

it("recognises every internal tracker prefix and tracker link", () => {
  for (const prefix of internalIssuePrefixes)
    expect(`fix ${prefix}-12 thing`).toMatch(internalReferencePattern);
  expect("see https://linear.app/team/issue/X").toMatch(
    internalReferencePattern,
  );
  for (const publicText of [
    "UTF-8, SHA-256 and ISO-8601",
    "type(scope): TICKET-123 short description",
    '"runId": "bts287-native-v1"',
  ])
    expect(publicText).not.toMatch(internalReferencePattern);
});

it("keeps internal ticket IDs and tracker links out of repository documentation", () => {
  expect(
    violationsIn(listFiles("*.md")),
    "Replace internal references with public feature descriptions",
  ).toEqual([]);
});

it("keeps internal ticket IDs and tracker links out of every shipped document", () => {
  // Everything `files` publishes apart from compiled output and source: the
  // guides, their retained evidence, and the always-included root documents.
  const shipped = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    .files.filter(
      (pattern) => !pattern.startsWith("!") && !/^(?:dist|src)$/.test(pattern),
    )
    .map(
      (pattern) =>
        `:(glob)${pattern.includes("*") ? pattern : `${pattern}/**`}`,
    );
  const files = listFiles(
    ...shipped,
    ":(glob)CHANGELOG.md",
    ":(glob)MIGRATION.md",
    ":(glob)README.md",
  );
  expect(files).toEqual(
    expect.arrayContaining([
      "CHANGELOG.md",
      "MIGRATION.md",
      "README.md",
      "docs/README.md",
      "docs/architecture/durable-execution.md",
      "docs/evidence/native-metering/mixed-settlement-2026-10-20.json",
    ]),
  );
  expect(
    violationsIn(files),
    "Replace internal references with public feature descriptions",
  ).toEqual([]);
});

it("indexes every guide in docs/README.md", () => {
  const index = readFileSync(join(root, "docs/README.md"), "utf8");
  const linked = new Set(
    [...index.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)].map(
      ([, href]) => href,
    ),
  );
  const guides = [
    ...readdirSync(join(root, "docs")),
    ...readdirSync(join(root, "docs/architecture")).map(
      (name) => `architecture/${name}`,
    ),
  ].filter((name) => name.endsWith(".md") && name !== "README.md");
  expect(guides.length).toBeGreaterThan(60);
  expect(
    guides.filter((name) => !linked.has(name)).sort(),
    "Add each guide to docs/README.md under a fitting heading",
  ).toEqual([]);
});

it("separates maintainer documents from consumer guides in the index", () => {
  const index = readFileSync(join(root, "docs/README.md"), "utf8");
  const [consumer, maintainer] = index.split(
    "\n## Maintaining this repository\n",
  );
  expect(maintainer, "missing maintainer heading").toBeTruthy();
  expect(maintainer).not.toMatch(/\n## /);
  for (const name of [
    "development.md",
    "pull-request-standard.md",
    "worktrees.md",
    "stripe-sandbox-worktrees.md",
    "releasing.md",
    "release-handoff.md",
    "example-balance-funding-cutover.md",
    "example-recovery-cutover.md",
    "react-workflows-audit.md",
    "maya-membership-verification.md",
  ]) {
    expect(maintainer, name).toContain(`](${name})`);
    expect(consumer, name).not.toContain(`](${name})`);
  }
});
