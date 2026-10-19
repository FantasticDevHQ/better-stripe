import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("narrows public catalog identity types and runs actual packed component readers", () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), "better-stripe-identity-consumer-"),
  );
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", directory], {
      stdio: "pipe",
    });
    const archive = readdirSync(directory).find((name) =>
      name.endsWith(".tgz"),
    );
    if (!archive) throw new Error("Package archive missing");
    execFileSync("tar", ["-xzf", resolve(directory, archive), "-C", directory]);
    const consumer = resolve(directory, "package");
    symlinkSync(
      resolve("node_modules"),
      resolve(consumer, "node_modules"),
      "dir",
    );
    copyFileSync(
      resolve("scripts/fixtures/catalog-identity-consumer.ts"),
      resolve(consumer, "consumer.ts"),
    );
    execFileSync(
      resolve("node_modules/.bin/tsc"),
      [
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "consumer.ts",
      ],
      { cwd: consumer, stdio: "pipe" },
    );
    const source = readFileSync(
      resolve("src/component/products/identity.test.ts"),
      "utf8",
    )
      .replace(
        'from "../_generated/api.js"',
        'from "./dist/component/_generated/api.js"',
      )
      .replace(
        'import { schema, modules } from "../../test.js";',
        'import schema from "./dist/component/schema.js";\nconst modules = import.meta.glob("./dist/component/**/*.js");',
      )
      .replace(
        'from "./queries.js"',
        'from "./dist/component/products/queries.js"',
      );
    writeFileSync(resolve(consumer, "consumer.test.ts"), source);
    writeFileSync(
      resolve(consumer, "vitest.config.mjs"),
      "export default {test:{include:['consumer.test.ts'],maxWorkers:1}};",
    );
    execFileSync(
      resolve("node_modules/.bin/vitest"),
      [
        "run",
        "--config",
        "vitest.config.mjs",
        "--reporter=json",
        "--outputFile=results.json",
      ],
      { cwd: consumer, stdio: "pipe" },
    );
    const result = JSON.parse(
      readFileSync(resolve(consumer, "results.json"), "utf8"),
    );
    expect(result.numPassedTests).toBe(17);
    expect(result.numFailedTests).toBe(0);
    expect(result.numPendingTests).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
