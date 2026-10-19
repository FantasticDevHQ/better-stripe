import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const [deployment, evidencePath] = process.argv.slice(2);
assert.match(
  deployment ?? "",
  /^dev:[a-z0-9-]+$/,
  "A development deployment is required",
);
assert.ok(evidencePath, "Provide a sanitized evidence output path");
for (const name of [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
]) {
  if (process.env[name])
    throw new Error(
      "Remove ambient Convex overrides before development verification",
    );
}
const root = process.cwd();
const temp = mkdtempSync(resolve(tmpdir(), "better-stripe-native-wiring-"));
try {
  execFileSync("pnpm", ["run", "build:clean"], { stdio: "pipe" });
  execFileSync("pnpm", ["pack", "--pack-destination", temp], { stdio: "pipe" });
  const archive = readdirSync(temp).find((name) => name.endsWith(".tgz"));
  assert.ok(archive);
  execFileSync("tar", ["-xzf", resolve(temp, archive), "-C", temp]);
  const packed = resolve(temp, "package");
  const metadata = JSON.parse(
    readFileSync(resolve(packed, "package.json"), "utf8"),
  );
  // Use the actual extracted candidate with the repository's pinned dependency graph.
  symlinkSync(
    resolve(root, "node_modules"),
    resolve(packed, "node_modules"),
    "dir",
  );
  const host = resolve(temp, "consumer");
  mkdirSync(resolve(host, "convex"), { recursive: true });
  mkdirSync(resolve(host, "node_modules/@fantastic.dev"), { recursive: true });
  for (const name of ["convex", "typescript"])
    symlinkSync(
      resolve(root, "node_modules", name),
      resolve(host, "node_modules", name),
      "dir",
    );
  symlinkSync(
    packed,
    resolve(host, "node_modules/@fantastic.dev/better-stripe"),
    "dir",
  );
  symlinkSync(
    resolve(root, "node_modules/@types"),
    resolve(host, "node_modules/@types"),
    "dir",
  );
  writeFileSync(
    resolve(host, "convex.json"),
    JSON.stringify({ codegen: { fileType: "ts", staticApi: true } }),
  );
  writeFileSync(
    resolve(host, "package.json"),
    JSON.stringify(
      {
        name: "packed-usage-native-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@fantastic.dev/better-stripe": `file:../${archive}`,
          convex: metadata.peerDependencies.convex,
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    resolve(host, "convex/convex.config.ts"),
    `import {defineApp} from "convex/server";
import {v} from "convex/values";
import betterStripe from "@fantastic.dev/better-stripe/convex.config";
const app=defineApp({env:{STRIPE_SECRET_KEY:v.string()}});
app.use(betterStripe,{env:{STRIPE_SECRET_KEY:app.env.STRIPE_SECRET_KEY}});
export default app;
`,
  );
  writeFileSync(
    resolve(host, "convex/health.ts"),
    `import {query} from "./_generated/server";
import {v} from "convex/values";
export const health=query({args:{},returns:v.string(),handler:()=>"packed consumer"});
`,
  );
  const generated = spawnSync(
    resolve(root, "node_modules/.bin/convex"),
    ["codegen", "--typecheck", "disable"],
    {
      cwd: host,
      env: { ...process.env, CONVEX_DEPLOYMENT: deployment },
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (generated.status !== 0)
    throw new Error(
      "Packed native codegen failed; inspect the selected development deployment. No secret values are emitted by this runner.",
    );
  const log = generated.stdout + generated.stderr;
  const api = readFileSync(resolve(host, "convex/_generated/api.ts"), "utf8");
  assert.ok(
    api.includes("betterStripe"),
    "Missing generated component reference",
  );
  writeFileSync(
    resolve(host, "consumer.ts"),
    `import {BetterStripe} from "@fantastic.dev/better-stripe";
import {components} from "./convex/_generated/api";
const stripe=new BetterStripe(components.betterStripe);
export const getSummary=stripe.usage.getSummary;
export const reserveCredits=stripe.usage.reserveCredits;
export const reserveAllowance=stripe.usage.reserveAllowance;
export const startDelivery=stripe.usage.startDelivery;
`,
  );
  execFileSync(
    resolve(root, "node_modules/.bin/tsc"),
    [
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "consumer.ts",
    ],
    { cwd: host, stdio: "pipe" },
  );
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        package: metadata.name,
        version: metadata.version,
        archiveSha256: createHash("sha256")
          .update(readFileSync(resolve(temp, archive)))
          .digest("hex"),
        deployment,
        entryPoint: "@fantastic.dev/better-stripe/convex.config",
        extractedPackage: true,
        dependencies: "repository pinned graph through symlinks",
        command: "convex codegen --typecheck disable",
        nativeComponentAnalysis: "passed",
        generatedReferences: ["betterStripe"],
        publicUsageMethodsTypechecked: [
          "getSummary",
          "reserveCredits",
          "reserveAllowance",
          "startDelivery",
        ],
        nestedRuntime: "packed component config and native component analysis",
        runningDeploymentModified: false,
        financialOperationsRequested: false,
        output: log.replaceAll(temp, "<temporary-consumer>"),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Packed native component analysis and generated usage bindings passed.",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
