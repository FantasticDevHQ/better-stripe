// Structural drift check for committed Convex component codegen output.
//
// Catches the most common stale-codegen case: a developer exports a new
// query/mutation/action from `src/component/<module>/{queries,mutations,actions}.ts`
// but forgets to regenerate `src/component/_generated/component.ts`.
//
// This is a HEURISTIC. It does NOT catch every drift case — for example,
// validator-shape changes that alter the generated types without adding a new
// function. The authoritative check is `pnpm codegen && git diff --exit-code`
// against a live Convex deployment (see the `codegen` CI job in
// `.github/workflows/ci.yml`, gated on the `CONVEX_DEPLOYMENT` secret).
//
// Why this exists: stale `_generated/component.ts` has shipped twice.
//   - BTS-31 / BTS-50 — `listTransfersByCharge`, `listTransfersByAccount`,
//     `getDisputeByStripeId`, `listDisputes` were missing from the committed
//     codegen even though they were exported from `src/component/connect/queries.ts`.
//   - BTS-74 — reversal queries were missing.
// Both were "added a function, didn't regen". A deployment-free structural
// check catches that whole class of bug without needing Convex credentials in CI.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const componentDir = join(root, "src", "component");
const generatedPath = join(componentDir, "_generated", "component.ts");

const generated = readFileSync(generatedPath, "utf8");

// Modules in `src/component/<module>/{queries,mutations,actions}.ts` map to
// nested blocks in `_generated/component.ts`:
//   `<module>: { queries: {...}, mutations: {...}, actions: {...} }`.
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
      const propRegex = new RegExp(`^\\s*${name}:\\s*FunctionReference`, "m");
      if (!propRegex.test(generated)) {
        missing.push(`${moduleDir}/${fileName}: export const ${name}`);
      }
    }
  }
}

if (missing.length > 0) {
  console.error(
    `Stale Convex codegen detected — these source exports are missing from ${generatedPath.replace(root + "/", "")}:\n` +
      missing.map((s) => `  - ${s}`).join("\n") +
      `\n\nRegenerate with \`pnpm codegen\` against your dev deployment and commit the result.\n` +
      `See README § "Regenerating codegen".`,
  );
  process.exit(1);
}

console.log(
  "✓ codegen drift check: src/component/_generated/component.ts is in sync with src/component/**/*.{queries,mutations,actions}.ts",
);
