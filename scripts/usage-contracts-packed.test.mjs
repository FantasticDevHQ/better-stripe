import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  mkdirSync,
  symlinkSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("loads all three configuration contracts from the actual packed consumer export", () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), "better-stripe-usage-consumer-"),
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
    mkdirSync(resolve(consumer, "node_modules"));
    for (const dependency of ["zod", "convex"]) {
      symlinkSync(
        resolve("node_modules", dependency),
        resolve(consumer, "node_modules", dependency),
        "dir",
      );
    }
    copyFileSync(
      resolve("scripts/fixtures/usage-consumer.ts"),
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
        `
    import {defineUsagePlan,parseUsageQuantity} from '@fantastic.dev/better-stripe/usage';
    const common={key:'calls',version:'v1',unit:{name:'request',precision:0},rate:{currency:'usd',unitAmountDecimal:'2'}};
    const plans=[{...common,model:'pay_as_you_go'},{...common,model:'included_overage',includedQuantity:'100',reset:'billing_period'},{...common,model:'prepaid',insufficientBalance:'reject'}].map(defineUsagePlan);
    console.log(JSON.stringify({models:plans.map(plan=>plan.model),quantity:parseUsageQuantity('9007199254740993',0).scaledQuantity}));
  `,
      ],
      { cwd: consumer, encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual({
      models: ["pay_as_you_go", "included_overage", "prepaid"],
      quantity: "9007199254740993",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
