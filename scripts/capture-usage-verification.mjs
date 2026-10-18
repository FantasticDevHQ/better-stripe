import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const [manifestPath, outputPath] = process.argv.slice(2);
assert.ok(
  manifestPath && outputPath,
  "Usage: node scripts/capture-usage-verification.mjs manifest.json output.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.match(manifest.deployment, /^dev:[a-z0-9-]+$/);
assert.equal(manifest.fixtures.length, 6);
assert.deepEqual(
  manifest.fixtures.map(({ role, model }) => `${role}:${model}`).sort(),
  ["customer", "seller"]
    .flatMap((role) =>
      ["pay_as_you_go", "included_overage", "prepaid"].map(
        (model) => `${role}:${model}`,
      ),
    )
    .sort(),
);
const results = {
  capturedAt: new Date().toISOString(),
  environment:
    "Existing Stripe sandbox; read-only native usage refresh of original archived fixtures; no new payments or transfers",
  models: {},
};
for (const fixture of manifest.fixtures) {
  assert.match(fixture.actorId, /^[a-z0-9]+$/);
  assert.match(fixture.runId, /^[a-z0-9]+$/);
  const result = {};
  for (const operation of ["observe", "snapshot", "history"]) {
    const request = {
      actorId: fixture.actorId,
      runId: fixture.runId,
      ...(operation === "history" ? { limit: 100, cursor: null } : {}),
    };
    let output;
    try {
      output = execFileSync(
        "pnpm",
        [
          "exec",
          "convex",
          "run",
          `meteredUsage/readers:${operation}`,
          JSON.stringify(request),
        ],
        {
          cwd: resolve("example"),
          env: { ...process.env, CONVEX_DEPLOYMENT: manifest.deployment },
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    } catch {
      throw new Error(
        `Native ${operation} failed; inspect the authorized development deployment.`,
      );
    }
    const value = JSON.parse(output);
    result[operation] = typeof value === "string" ? JSON.parse(value) : value;
  }
  results.models[`${fixture.role}:${fixture.model}`] = result;
}
writeFileSync(outputPath, JSON.stringify(results, null, 2) + "\n");
console.log(
  "Captured six original sandbox model histories and native summaries; no new financial operation requested.",
);
