/**
 * Tests for scripts/check-codegen-drift.mjs.
 *
 * Each test builds a minimal fixture tree under a fresh tmpdir (only the
 * files each check actually reads matter — the generated files don't need
 * to be valid TypeScript, since the checks only read them as text) and runs
 * `checkLibraryComponent` / `checkExampleApp` against that fixture root, so
 * these run purely against fixtures and never touch this repo's own
 * `_generated/` output.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkExampleApp, checkLibraryComponent } from "./check-codegen-drift.mjs";

let fixtureRoot;

afterEach(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});

function makeFixtureRoot() {
  fixtureRoot = mkdtempSync(join(tmpdir(), "codegen-drift-test-"));
  return fixtureRoot;
}

describe("checkLibraryComponent", () => {
  it("passes when every source export has a matching generated entry", () => {
    const root = makeFixtureRoot();
    mkdirSync(join(root, "src", "component", "billing"), { recursive: true });
    mkdirSync(join(root, "src", "component", "_generated"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "src", "component", "billing", "queries.ts"),
      `export const getFoo = query({\n  handler: async () => null,\n});\n`,
    );
    writeFileSync(
      join(root, "src", "component", "_generated", "component.ts"),
      `export type ComponentApi = {\n  billing: {\n    queries: {\n      getFoo: FunctionReference<"query">;\n    };\n  };\n};\n`,
    );

    const result = checkLibraryComponent(root);

    expect(result.ok).toBe(true);
  });

  it("flags a source export missing from the generated file (added, not regenerated)", () => {
    const root = makeFixtureRoot();
    mkdirSync(join(root, "src", "component", "billing"), { recursive: true });
    mkdirSync(join(root, "src", "component", "_generated"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "src", "component", "billing", "queries.ts"),
      `export const getFoo = query({\n  handler: async () => null,\n});\nexport const getBar = query({\n  handler: async () => null,\n});\n`,
    );
    writeFileSync(
      join(root, "src", "component", "_generated", "component.ts"),
      `export type ComponentApi = {\n  billing: {\n    queries: {\n      getFoo: FunctionReference<"query">;\n    };\n  };\n};\n`,
    );

    const result = checkLibraryComponent(root);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("billing/queries.ts: export const getBar");
  });

  it("flags a generated entry whose source export was deleted (BTS-112)", () => {
    const root = makeFixtureRoot();
    mkdirSync(join(root, "src", "component", "billing"), { recursive: true });
    mkdirSync(join(root, "src", "component", "_generated"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "src", "component", "billing", "queries.ts"),
      `export const getFoo = query({\n  handler: async () => null,\n});\n`,
    );
    // component.ts still has an entry for a query that was deleted from
    // source without regenerating — this is the deletion case the forward
    // (source -> generated) loop can never catch.
    writeFileSync(
      join(root, "src", "component", "_generated", "component.ts"),
      `export type ComponentApi = {\n  billing: {\n    queries: {\n      getFoo: FunctionReference<"query">;\n      getDeleted: FunctionReference<"query">;\n    };\n  };\n};\n`,
    );

    const result = checkLibraryComponent(root);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("getDeleted");
    expect(result.message).toContain("no matching source export");
  });

  it("does not detect customQuery-style wrapper exports (documented, deliberate limitation)", () => {
    const root = makeFixtureRoot();
    mkdirSync(join(root, "src", "component", "billing"), { recursive: true });
    mkdirSync(join(root, "src", "component", "_generated"), {
      recursive: true,
    });
    // This component has zero wrapper/re-export patterns today (see the
    // comment in check-codegen-drift.mjs) — a `customQuery(...)` export is
    // invisible to the checker by design, not by accident. This test locks
    // in that documented behavior so a future regex change is a deliberate,
    // reviewed decision rather than a silent behavior shift.
    writeFileSync(
      join(root, "src", "component", "billing", "queries.ts"),
      `export const getWrapped = customQuery({\n  handler: async () => null,\n});\n`,
    );
    writeFileSync(
      join(root, "src", "component", "_generated", "component.ts"),
      `export type ComponentApi = {\n  billing: {\n    queries: {};\n  };\n};\n`,
    );

    const result = checkLibraryComponent(root);

    expect(result.ok).toBe(true);
  });
});

describe("checkExampleApp", () => {
  function writeGeneratedApi(root, entries) {
    const imports = entries
      .map((e) => `import type * as ${e.alias} from "../${e.modulePath}.js";`)
      .join("\n");
    const fullApiEntries = entries
      .map((e) => `  ${e.modulePath}: typeof ${e.alias};`)
      .join("\n");
    writeFileSync(
      join(root, "example", "convex", "_generated", "api.ts"),
      `${imports}\n\nconst fullApi: ApiFromModules<{\n${fullApiEntries}\n}> = anyApi as any;\n`,
    );
  }

  it("passes when every source module has a matching generated entry", () => {
    const root = makeFixtureRoot();
    mkdirSync(join(root, "example", "convex", "_generated"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "example", "convex", "foo.ts"),
      `export const foo = 1;\n`,
    );
    writeGeneratedApi(root, [{ alias: "foo", modulePath: "foo" }]);

    const result = checkExampleApp(root);

    expect(result.ok).toBe(true);
  });

  it("flags a source module missing from the generated file (added, not regenerated)", () => {
    const root = makeFixtureRoot();
    mkdirSync(join(root, "example", "convex", "_generated"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "example", "convex", "foo.ts"),
      `export const foo = 1;\n`,
    );
    writeFileSync(
      join(root, "example", "convex", "bar.ts"),
      `export const bar = 1;\n`,
    );
    writeGeneratedApi(root, [{ alias: "foo", modulePath: "foo" }]);

    const result = checkExampleApp(root);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("bar.ts: missing import for bar");
  });

  it("flags a generated import whose source module was deleted (BTS-112)", () => {
    const root = makeFixtureRoot();
    mkdirSync(join(root, "example", "convex", "_generated"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "example", "convex", "foo.ts"),
      `export const foo = 1;\n`,
    );
    // api.ts still imports "bar", but example/convex/bar.ts was deleted
    // without regenerating — the forward (source -> generated) loop can
    // never catch this, since it only ever walks source files that exist.
    writeGeneratedApi(root, [
      { alias: "foo", modulePath: "foo" },
      { alias: "bar", modulePath: "bar" },
    ]);

    const result = checkExampleApp(root);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("bar.ts");
    expect(result.message).toContain("no matching source module");
  });

  it("flags a deleted nested module file (e.g. lib/marketplace.ts)", () => {
    const root = makeFixtureRoot();
    mkdirSync(join(root, "example", "convex", "_generated"), {
      recursive: true,
    });
    writeGeneratedApi(root, [
      { alias: "lib_marketplace", modulePath: "lib/marketplace" },
    ]);

    const result = checkExampleApp(root);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("lib/marketplace.ts");
  });
});
