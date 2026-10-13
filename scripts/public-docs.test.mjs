import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps internal ticket IDs and tracker links out of repository documentation", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "*.md"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const internalReference =
    /\bBTS(?:-\d|\b)|https?:\/\/(?:www\.)?linear\.app\//i;
  const violations = [];
  for (const file of new Set(files)) {
    if (!file) continue;
    readFileSync(join(root, file), "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (internalReference.test(line))
          violations.push(`${file}:${index + 1}`);
      });
  }
  expect(
    violations,
    "Replace internal references with public feature descriptions",
  ).toEqual([]);
});
