import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("compiles the server authorization hook through the actual packed public export", () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), "better-stripe-settlement-hook-"),
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
      resolve("scripts/fixtures/settlement-authorization-consumer.ts"),
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
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "import {BetterStripe} from '@fantastic.dev/better-stripe'; console.log(typeof BetterStripe.prototype.settleSale);",
      ],
      { cwd: consumer, encoding: "utf8" },
    );
    expect(output.trim()).toBe("function");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
