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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Convex imports every TypeScript source module under convex/ into the
// generated api.ts. Hand-authored .d.ts files are generated-type artifacts,
// not source modules, and would never appear in api.ts. This repo's example/
// workspace is all-.ts today; Convex also allows .js/.jsx/.tsx/.cjs/.mjs
// modules, so extend isSourceModule if that ever changes.
function isSourceModule(fileName) {
  return fileName.endsWith(".ts") && !fileName.endsWith(".d.ts");
}

function walkTsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(path));
    } else if (entry.isFile() && isSourceModule(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

// Convex quotes the object key in `ApiFromModules<...>` whenever the module
// path is not a valid bare JavaScript identifier (e.g. `lib/marketplace` or
// `my-module`). A simple `.includes("/")` check is insufficient: a
// hyphenated top-level name like `my-module` is also quoted.
function isValidJsIdentifier(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

// Layer 1: library component codegen.
// Modules in `src/component/<module>/{queries,mutations,actions}.ts` map to
// nested blocks in `src/component/_generated/component.ts`:
//   `<module>: { queries: {...}, mutations: {...}, actions: {...} }`.
function checkLibraryComponent(componentRoot = root) {
  const componentDir = join(componentRoot, "src", "component");
  const generatedPath = join(componentDir, "_generated", "component.ts");
  const generated = readFileSync(generatedPath, "utf8");

  const MODULES = ["billing", "connect", "core", "products", "webhooks"];
  const KINDS = [
    ["queries", "queries.ts", "query"],
    ["mutations", "mutations.ts", "mutation"],
    ["actions", "actions.ts", "action"],
  ];

  const missing = [];
  const sourceNames = new Set();

  for (const moduleDir of MODULES) {
    for (const [kind, fileName, singular] of KINDS) {
      let source;
      try {
        source = readFileSync(join(componentDir, moduleDir, fileName), "utf8");
      } catch {
        // No source file for this kind in this module — nothing to check.
        continue;
      }

      // `export const NAME = query(` / `mutation(` / `action(` at the start of
      // a line. This deliberately does NOT match wrapper patterns like
      // `export const myQuery = customQuery(...)` (convex-helpers) or
      // re-exports like `export { myQuery as NAME }`: this component has zero
      // such exports today (verified across every queries/mutations/actions.ts
      // — grep for `customQuery|customMutation|customAction|convex-helpers`
      // turns up nothing, and there's no `convex-helpers` dependency), and its
      // functions are exported directly with `query(...)`/`mutation(...)`/
      // `action(...)`. If that changes, widen this regex (and the matching
      // reverse-check below) rather than assuming it stays this way.
      const fnRegex = new RegExp(`^export const (\\w+) = ${singular}\\(`, "gm");
      const names = new Set();
      let match;
      while ((match = fnRegex.exec(source)) !== null) {
        names.add(match[1]);
      }
      if (names.size === 0) continue;

      for (const name of names) {
        sourceNames.add(name);
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

  // Reverse direction: every `NAME: FunctionReference<` entry in the
  // generated file must correspond to a source export found above. Without
  // this, deleting an exported query/mutation/action (without regenerating)
  // leaves a stale entry in component.ts and goes undetected — the forward
  // loop above only ever walks source -> generated, never the reverse.
  const stale = [];
  const generatedFnRegex = /^\s*(\w+):\s*FunctionReference/gm;
  let generatedMatch;
  while ((generatedMatch = generatedFnRegex.exec(generated)) !== null) {
    const name = generatedMatch[1];
    if (!sourceNames.has(name)) {
      stale.push(name);
    }
  }

  if (missing.length > 0 || stale.length > 0) {
    const relativeGeneratedPath = generatedPath.replace(
      componentRoot + sep,
      "",
    );
    const sections = [];
    if (missing.length > 0) {
      sections.push(
        `these source exports are missing from ${relativeGeneratedPath}:\n` +
          missing.map((s) => `  - ${s}`).join("\n"),
      );
    }
    if (stale.length > 0) {
      sections.push(
        `these entries in ${relativeGeneratedPath} have no matching source export (likely a deleted query/mutation/action):\n` +
          stale.map((s) => `  - ${s}`).join("\n"),
      );
    }
    return {
      ok: false,
      message: `Stale Convex codegen detected — ${sections.join("\n\n")}`,
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
function checkExampleApp(exampleRoot = root) {
  const convexDir = join(exampleRoot, "example", "convex");
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

    // Convex path components can only contain alphanumeric chars, underscores,
    // or periods, so a hyphenated top-level filename (e.g. my-module.ts) is
    // structurally impossible and would be rejected at push time. We still use
    // identifier validity here because it is the correct JS-grammar rule and
    // safely covers nested slash paths like lib/marketplace as well.
    const keyPattern = isValidJsIdentifier(modulePath)
      ? escapeRegExp(modulePath)
      : `"${escapeRegExp(modulePath)}"`;
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

  // Reverse direction: every module the generated file imports must still
  // exist as a source file on disk. Without this, deleting an
  // `example/convex/<module>.ts` (without regenerating) leaves a stale import
  // + fullApi entry in api.ts and goes undetected — the forward loop above
  // only ever walks source -> generated, never the reverse.
  const stale = [];
  const importRegex = /^import type \* as (\w+) from ["'](\.\.\/[^"']+)\.js["'];$/gm;
  let importMatch;
  while ((importMatch = importRegex.exec(generated)) !== null) {
    const [, alias, importPath] = importMatch;
    const modulePath = importPath.replace(/^\.\.\//, "");
    const sourcePath = join(convexDir, `${modulePath}.ts`);
    if (!existsSync(sourcePath)) {
      stale.push(`${alias}: imports "${modulePath}.ts", which no longer exists`);
    }
  }

  if (missing.length > 0 || stale.length > 0) {
    const relativeGeneratedPath = generatedPath.replace(
      exampleRoot + sep,
      "",
    );
    const sections = [];
    if (missing.length > 0) {
      sections.push(
        `these source modules are missing from ${relativeGeneratedPath}:\n` +
          missing.map((s) => `  - ${s}`).join("\n"),
      );
    }
    if (stale.length > 0) {
      sections.push(
        `these entries in ${relativeGeneratedPath} have no matching source module (likely a deleted file):\n` +
          stale.map((s) => `  - ${s}`).join("\n"),
      );
    }
    return {
      ok: false,
      message: `Stale Convex codegen detected — ${sections.join("\n\n")}`,
    };
  }

  return {
    ok: true,
    message:
      "✓ codegen drift check: example/convex/_generated/api.ts is in sync with example/convex/**/*.ts",
  };
}

function main() {
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
}

// Guard so this module can be imported by tests (which call
// checkLibraryComponent/checkExampleApp directly against fixture roots)
// without also running the CLI's process.exit(1) side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { checkExampleApp, checkLibraryComponent };
