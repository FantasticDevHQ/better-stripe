#!/usr/bin/env node
// Build reviewed release notes without removing Release Please's parsing boundaries.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { releaseNotes } from "./release-notes.mjs";

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
    throw new Error("An exact numeric package version is required.");
}

/** Single-package subset of Release Please's delimiter and version contract. */
export function validateReleaseDescription(body, version) {
  validateVersion(version);
  const lines = body.trim().replace(/\r\n/g, "\n").split("\n");
  const separators = lines.flatMap((line, index) =>
    line === "---" ? [index] : [],
  );
  if (separators.length !== 2)
    throw new Error(
      "Release description requires exactly two notes separators.",
    );
  const content = lines
    .slice(separators[0] + 1, separators[1])
    .join("\n")
    .trim();
  // Release Please prioritizes HTML details summaries over the Markdown version.
  // This single-package command deliberately refuses that alternate selector form.
  if (/<\s*(?:details|summary)\b/i.test(content))
    throw new Error(
      "Nested release details are not supported in single-package notes.",
    );
  const headings = content.split("\n").filter((line) => /^## /.test(line));
  if (
    headings.length !== 1 ||
    headings[0] !== `## [${version}]` ||
    !content.startsWith(`## [${version}]\n`) ||
    !content.slice(`## [${version}]`.length).trim()
  )
    throw new Error(
      "Release notes must describe only the exact selected version.",
    );
}

export function releaseDescription(changelog, version, evidence) {
  validateVersion(version);
  const notes = releaseNotes(changelog, version);
  if (!notes)
    throw new Error("The selected changelog version has no release notes.");
  const body = `Reviewed release candidate\n---\n\n## [${version}]\n\n${notes}\n\n---\n${evidence}`;
  validateReleaseDescription(body, version);
  return body;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, version, file, changelog = "CHANGELOG.md"] =
      process.argv.slice(2);
    if (!file || !["build", "check"].includes(mode))
      throw new Error(
        "Usage: release-description.mjs build|check <version> <evidence-or-body-file> [changelog]",
      );
    const input = readFileSync(file, "utf8");
    if (mode === "check") {
      validateReleaseDescription(input, version);
      console.log(
        "Release description has parseable exact-version notes boundaries.",
      );
    } else
      console.log(
        releaseDescription(readFileSync(changelog, "utf8"), version, input),
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
