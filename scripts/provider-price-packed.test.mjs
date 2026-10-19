import { execFileSync, spawnSync } from "node:child_process";
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

it("exposes typed provider-price pages and executes the packed component contract", () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), "better-stripe-provider-price-consumer-"),
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
      resolve("scripts/fixtures/provider-price-consumer.ts"),
      resolve(consumer, "consumer.ts"),
    );
    const types = spawnSync(
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
      { cwd: consumer, encoding: "utf8" },
    );
    expect(types.status, types.stdout + types.stderr).toBe(0);
    const source = readFileSync(
      resolve("src/component/products/provider-price-pagination.test.ts"),
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
    writeFileSync(
      resolve(consumer, "consumer.test.ts"),
      source.replace(
        'from "../_generated/dataModel.js"',
        'from "./dist/component/_generated/dataModel.js"',
      ),
    );
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
    expect(result.numPassedTests).toBe(5);
    expect(result.numFailedTests).toBe(0);
    expect(result.numPendingTests).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
