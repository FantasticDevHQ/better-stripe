import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { qualifyCapturedCheckoutPayment } from "@fantastic.dev/better-stripe";

it("loads the compiled public qualifier without qualifying incomplete evidence", () => {
  expect(import.meta.resolve("@fantastic.dev/better-stripe")).toMatch(
    /\/dist\/client\/index\.js$/,
  );
  expect(
    qualifyCapturedCheckoutPayment(
      {},
      {
        stripeSessionId: "cs_original",
        customerAccountId: "acct_buyer",
        livemode: false,
      },
    ),
  ).toEqual({ status: "unavailable", reason: "invalid_evidence" });
});

it("narrows the strict public captured-payment consumer contract", () => {
  const compiler = spawnSync(
    resolve("node_modules/.bin/tsc"),
    [
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "false",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "scripts/fixtures/captured-checkout-payment-consumer.ts",
    ],
    { stdio: "pipe", encoding: "utf8", timeout: 30_000 },
  );
  // Only compiler diagnostics from the public fixture, never the command environment.
  const diagnostics = [compiler.stdout, compiler.stderr]
    .filter(Boolean)
    .map((output) => output.slice(0, 16_384))
    .join("\n");
  if (compiler.error)
    throw new Error(
      `Strict consumer compiler ${compiler.error.name}\n${diagnostics}`,
    );
  expect(compiler.status, diagnostics).toBe(0);
}, 35_000);
