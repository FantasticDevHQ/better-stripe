import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertNoTestArtifacts,
  findTestArtifacts,
  isTestArtifact,
} from "./check-dist-artifacts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

describe("compiled output artifact check", () => {
  const directories = [];
  const outputDirectory = (paths) => {
    const directory = mkdtempSync(join(tmpdir(), "better-stripe-dist-check-"));
    directories.push(directory);
    for (const path of paths) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), "");
    }
    return directory;
  };
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  const publicOutputs = [
    "client/index.js",
    "client/index.d.ts",
    "client/index.js.map",
    "client/index.d.ts.map",
    "client/setup.js",
    "client/contest.js",
    "client/latestHelpers.js",
    "component/_generated/component.js",
    "testing/index.js",
    "testing/fixtures.js",
    "testing/fixtures.d.ts",
    "testing/mock-webhooks.js",
    "testing/assert-test-env.js",
  ];
  const testOutputs = [
    "client/setup.test.js",
    "client/setup.test.d.ts",
    "client/setup.test.js.map",
    "client/setup.test.d.ts.map",
    "react/Checkout.test.js",
    "client/usage/subscription.fixtures.js",
    "client/settlement/authorization.fixture.d.ts",
    "client/connect/payoutSyncTestHelpers.js",
    "client/billing/renewalAttach/internal/test-fixtures/stockHttp.js",
    "client/billing/renewalAttach/internal/c10/test-fixtures/frozen/f19.json",
    "client/billing/renewalAttach/internal/c10/test-fixtures/fixture.mjs",
    "test.js",
    "test.d.ts",
    "testing/component-db.js",
    "testing/crossDomain/host.js",
  ];

  it("accepts a directory holding only public outputs, including ./testing", () => {
    const directory = outputDirectory(publicOutputs);
    expect(findTestArtifacts(directory)).toEqual([]);
    expect(() => assertNoTestArtifacts(directory)).not.toThrow();
  });

  it("reports every test and fixture output", () => {
    const directory = outputDirectory([...publicOutputs, ...testOutputs]);
    expect(findTestArtifacts(directory)).toEqual(
      [...new Set(testOutputs)].sort(),
    );
    expect(() => assertNoTestArtifacts(directory)).toThrow(
      /test or fixture artifact\(s\)[\s\S]*client\/setup\.test\.js[\s\S]*build:clean/,
    );
  });

  it("fails for a missing directory instead of passing vacuously", () => {
    expect(() =>
      findTestArtifacts(join(tmpdir(), "better-stripe-absent")),
    ).toThrow("Directory not found");
  });

  it("is run by the build's public export check", () => {
    expect(readJson("package.json").scripts.build).toContain(
      "scripts/check-public-exports.mjs",
    );
    expect(
      readFileSync(join(root, "scripts/check-public-exports.mjs"), "utf8"),
    ).toMatch(/assertNoTestArtifacts\(/);
  });
});

describe("published package contents", () => {
  const manifest = readJson("package.json");
  const buildExcludes = readJson("tsconfig.build.json").exclude;

  it("excludes test-only sources by pattern rather than by a hand-maintained list", () => {
    expect(buildExcludes).toEqual(
      expect.arrayContaining([
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.test.js",
        "src/**/*.fixture.ts",
        "src/**/*.fixtures.ts",
        "src/**/*TestHelpers.ts",
        "src/**/test-fixtures/**",
      ]),
    );
  });

  it("does not publish any source the build excludes as test-only", () => {
    // `_generated` is excluded as a compile root but is still emitted through
    // imports, so its sources stay published for the source maps.
    const testOnly = buildExcludes.filter(
      (pattern) => pattern !== "src/component/_generated",
    );
    expect(testOnly.length).toBeGreaterThan(5);
    // Negated `files` patterns made packing about eight times slower, so the
    // exclusions live in `src/.npmignore`, relative to `src`.
    expect(manifest.files.filter((entry) => entry.startsWith("!"))).toEqual([]);
    const ignored = readFileSync(join(root, "src/.npmignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());
    for (const pattern of testOnly) {
      const relative = pattern.replace(/^src\//, "");
      const basename = relative.replace(/^\*\*\//, "");
      const expected = basename.includes("/") ? relative : basename;
      expect(ignored, `src/.npmignore must list ${expected}`).toContain(
        expected,
      );
    }
  });

  it("packs the shipped sources without tests or fixtures", () => {
    const [{ files }] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    const sources = files
      .map(({ path }) => path)
      .filter((path) => path.startsWith("src/"));
    // The source tree is shipped for source and declaration maps.
    expect(sources).toEqual(
      expect.arrayContaining([
        "src/client/index.ts",
        "src/react/index.ts",
        "src/component/convex.config.ts",
        "src/component/_generated/component.ts",
        "src/testing/index.ts",
        "src/testing/fixtures.ts",
        "src/testing/mock-webhooks.ts",
      ]),
    );
    expect(sources.length).toBeGreaterThan(500);
    // Sources map 1:1 onto outputs, so the output check names the offenders.
    expect(
      sources.filter((path) => isTestArtifact(path.slice("src/".length))),
    ).toEqual([]);
  }, 60_000);
});
