import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("compiles and runs public custom promotions from the actual archive without repository aliases", () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), "better-stripe-promotions-consumer-"),
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
      resolve("scripts/fixtures/checkout-promotion-consumer.ts"),
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
    const resolved = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "console.log(import.meta.resolve('@fantastic.dev/better-stripe/react'))",
      ],
      { cwd: consumer, encoding: "utf8" },
    ).trim();
    expect(resolved).toBe(
      pathToFileURL(realpathSync(resolve(consumer, "dist/react/index.js")))
        .href,
    );
    const source = readFileSync(
      resolve("src/react/hooks/useCheckoutSession.promotions.test.tsx"),
      "utf8",
    );
    writeFileSync(
      resolve(consumer, "consumer.test.tsx"),
      source.replace(
        'from "../index.js"',
        'from "@fantastic.dev/better-stripe/react"',
      ),
    );
    writeFileSync(
      resolve(consumer, "vitest.config.mjs"),
      "export default {test:{include:['consumer.test.tsx'],maxWorkers:1}};",
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
    expect(result.numPassedTests).toBeGreaterThanOrEqual(20);
    expect(result.numFailedTests).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
