#!/usr/bin/env node
// Fail when a compiled output directory contains test or fixture artifacts.
// `tsc` never deletes outputs, so this also catches stale files left in `dist`
// by an earlier build that used a looser tsconfig.build.json.
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const emitted = String.raw`(?:\.d)?\.[cm]?[jt]s(?:\.map)?$`;

/**
 * Test-only outputs. `testing/` (the public `./testing` export) is deliberately
 * not matched: only the names below are test-only by repository convention, and
 * tsconfig.build.json excludes the matching sources.
 */
export const testArtifactPatterns = Object.freeze([
  new RegExp(String.raw`\.test${emitted}`),
  new RegExp(String.raw`\.fixtures?${emitted}`),
  new RegExp(String.raw`TestHelpers${emitted}`),
  /(?:^|\/)test-fixtures\//,
  new RegExp(String.raw`^test${emitted}`),
  new RegExp(String.raw`^testing/component-db${emitted}`),
  /^testing\/crossDomain\//,
]);

export function isTestArtifact(path) {
  return testArtifactPatterns.some((pattern) => pattern.test(path));
}

/** Returns sorted POSIX paths, relative to `directory`, of test artifacts. */
export function findTestArtifacts(directory) {
  const root = resolve(directory);
  if (!existsSync(root)) throw new Error(`Directory not found: ${directory}`);
  const found = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else {
        const name = relative(root, path).split(sep).join("/");
        if (isTestArtifact(name)) found.push(name);
      }
    }
  }
  return found.sort();
}

export function assertNoTestArtifacts(directory) {
  const found = findTestArtifacts(directory);
  if (!found.length) return;
  const shown = found.slice(0, 20).map((path) => `  ${path}`);
  if (found.length > shown.length)
    shown.push(`  ... and ${found.length - shown.length} more`);
  throw new Error(
    `${found.length} test or fixture artifact(s) in ${directory}:\n${shown.join("\n")}\n` +
      "Exclude the sources in tsconfig.build.json. If they are leftovers from an " +
      "earlier build, run `pnpm run build:clean`.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const directory =
    process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url));
  try {
    assertNoTestArtifacts(directory);
    console.log(`No test or fixture artifacts in ${directory}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
