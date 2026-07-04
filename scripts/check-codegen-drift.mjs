// Structural drift check for committed Convex codegen output.
//
// Catches the most common stale-codegen case: a developer exports a new
// query/mutation/action but forgets to regenerate the matching `_generated/`
// file.
//
// This is a HEURISTIC. It does NOT catch every drift case — for example,
// validator-shape changes that alter the generated types without adding a new
// function. The authoritative check is `pnpm codegen && git diff --exit-code`
// against a live Convex deployment (see the `codegen` CI job in
// `.github/workflows/ci.yml`, gated on the `CONVEX_DEPLOYMENT` secret).
//
// Why this exists: stale `_generated/` files have shipped multiple times.
//   - BTS-31 / BTS-50 — `listTransfersByCharge`, `listTransfersByAccount`,
//     `getDisputeByStripeId`, `listDisputes` were missing from the committed
//     codegen even though they were exported from `src/component/connect/queries.ts`.
//   - BTS-74 — reversal queries were missing.
// Both were "added a function, didn't regen". A deployment-free structural
// check catches that whole class of bug without needing Convex credentials in CI.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walkTsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

// Layer 1: library component codegen.
// Modules in `src/component/<module>/{queries,mutations,actions}.ts` map to
// nested blocks in `src/component/_generated/component.ts`:
//   `<module>: { queries: {...}, mutations: {...}, actions: {...} }`.
function checkLibraryComponent() {
  const componentDir = join(root, "src", "component");
  const generatedPath = join(componentDir, "_generated", "component.ts");
  const generated = readFileSync(generatedPath, "utf8");

  const MODULES = ["billing", "connect", "core", "products", "webhooks"];
  const KINDS = [
    ["queries", "queries.ts", "query"],
    ["mutations", "mutations.ts", "mutation"],
    ["actions", "actions.ts", "action"],
  ];

  const missing = [];

  for (const moduleDir of MODULES) {
    for (const [kind, fileName, singular] of KINDS) {
      let source;
      try {
        source = readFileSync(join(componentDir, moduleDir, fileName), "utf8");
      } catch {
        // No source file for this kind in this module — nothing to check.
        continue;
      }

      // `export const NAME = query(` / `mutation(` / `action(` at the start of a line.
      const fnRegex = new RegExp(`^export const (\\w+) = ${singular}\\(`, "gm");
      const names = new Set();
      let match;
      while ((match = fnRegex.exec(source)) !== null) {
        names.add(match[1]);
      }
      if (names.size === 0) continue;

      for (const name of names) {
        // Generated form: `NAME: FunctionReference<` as a property key. All
        // function names are unique across the component's API surface (a
        // Convex requirement), so a global substring check can't false-negative
        // on shadowing between modules.
        const propRegex = new RegExp(
          `^\\s*${name}:\\s*FunctionReference`,
          "m",
        );
        if (!propRegex.test(generated)) {
          missing.push(`${moduleDir}/${fileName}: export const ${name}`);
        }
      }
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message:
        `Stale Convex codegen detected — these source exports are missing from ${generatedPath.replace(root + "/", "")}:\n` +
        missing.map((s) => `  - ${s}`).join("\n"),
    };
  }

  return {
    ok: true,
    message:
      "✓ codegen drift check: src/component/_generated/component.ts is in sync with src/component/**/*.{queries,mutations,actions}.ts",
  };
}

// Layer 2: example app codegen.
// `example/convex/_generated/api.ts` imports every TypeScript source module
// under `example/convex/` and registers it in the `ApiFromModules<...>` type.
// A common drift case is adding a new `example/convex/<module>.ts` (or a nested
// file like `example/convex/lib/<module>.ts`) without regenerating.
function checkExampleApp() {
  const convexDir = join(root, "example", "convex");
  const generatedPath = join(convexDir, "_generated", "api.ts");
  const generated = readFileSync(generatedPath, "utf8");

  const sourceFiles = walkTsFiles(convexDir).filter((path) => {
    const rel = relative(convexDir, path);
    if (rel.startsWith("_generated" + sep)) return false;
    if (rel.endsWith(".test.ts")) return false;
    if (rel === "schema.ts") return false;
    if (rel === "convex.config.ts") return false;
    return true;
  });

  const missing = [];

  for (const sourcePath of sourceFiles) {
    const rel = relative(convexDir, sourcePath).replace(/\\/g, "/");
    const modulePath = rel.replace(/\.ts$/, "");
    const alias = modulePath.replace(/\//g, "_");
    const importPath = `../${modulePath}.js`;

    const importRegex = new RegExp(
      `^import type \\* as ${alias} from ["']${escapeRegExp(importPath)}["'];`,
      "m",
    );
    if (!importRegex.test(generated)) {
      missing.push(`${rel}: missing import for ${alias} from ${importPath}`);
      continue;
    }

    const keyPattern = modulePath.includes("/")
      ? `"${escapeRegExp(modulePath)}"`
      : escapeRegExp(modulePath);
    const fullApiRegex = new RegExp(
      `^\\s*${keyPattern}:\\s*typeof\\s+${alias}\\s*[,;]`,
      "m",
    );
    if (!fullApiRegex.test(generated)) {
      missing.push(
        `${rel}: missing fullApi entry "${modulePath}": typeof ${alias}`,
      );
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message:
        `Stale Convex codegen detected — these source modules are missing from ${generatedPath.replace(root + "/", "")}:\n` +
        missing.map((s) => `  - ${s}`).join("\n"),
    };
  }

  return {
    ok: true,
    message:
      "✓ codegen drift check: example/convex/_generated/api.ts is in sync with example/convex/**/*.ts",
  };
}

const results = [checkLibraryComponent(), checkExampleApp()];

for (const result of results) {
  if (result.ok) {
    console.log(result.message);
  } else {
    console.error(
      `${result.message}\n\nRegenerate with \`pnpm codegen\` against your dev deployment and commit the result.\n` +
        `See README § "Regenerating codegen".`,
    );
    process.exit(1);
  }
}
