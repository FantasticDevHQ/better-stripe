import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  symlinkSync,
  rmSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("composes public authorization and the genuine ledger from the built archive", () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), "better-stripe-composition-consumer-"),
  );
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", directory], {
      stdio: "pipe",
    });
    const archive = readdirSync(directory).find((name) =>
      name.endsWith(".tgz"),
    );
    execFileSync("tar", ["-xzf", resolve(directory, archive), "-C", directory]);
    const consumer = resolve(directory, "package");
    symlinkSync(
      resolve("node_modules"),
      resolve(consumer, "node_modules"),
      "dir",
    );
    copyFileSync(
      resolve("scripts/fixtures/usage-record-consumer.mjs"),
      resolve(consumer, "consumer.test.mjs"),
    );
    writeFileSync(
      resolve(consumer, "vitest.config.mjs"),
      "export default {test:{include:['consumer.test.mjs'],maxWorkers:1}};",
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
    expect(result.numPassedTests).toBe(1);
    expect(result.numFailedTests).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
