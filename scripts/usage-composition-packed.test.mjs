import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  symlinkSync,
  rmSync,
  copyFileSync,
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
      resolve(consumer, "consumer.mjs"),
    );
    const output = execFileSync(process.execPath, ["consumer.mjs"], {
      cwd: consumer,
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual({
      composition: true,
      replay: true,
      eventCount: 1,
      tamperRejections: 9,
      authorizationDenials: 2,
      providerCalls: 0,
      archiveExports: true,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
