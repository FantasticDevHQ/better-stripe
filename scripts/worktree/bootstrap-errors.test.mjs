import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedMissingEnvironment } from "./bootstrap-errors.mjs";

test("recognizes current and legacy declared bootstrap environment errors", () => {
  assert.equal(
    expectedMissingEnvironment("STRIPE_SECRET_KEY is not set", [
      "STRIPE_SECRET_KEY",
    ]),
    true,
  );
  assert.equal(
    expectedMissingEnvironment(
      "MissingEnvironmentVariables: Required environment variables are not set: STRIPE_SECRET_KEY. Set them before pushing.",
      ["STRIPE_SECRET_KEY"],
    ),
    true,
  );
  assert.equal(
    expectedMissingEnvironment(
      "Required environment variables are not set: KEY_A, KEY_B.",
      ["KEY_A", "KEY_B"],
    ),
    true,
  );
});

test("unknown variables and unrelated failures remain failures", () => {
  assert.equal(
    expectedMissingEnvironment(
      "Required environment variables are not set: KEY_A, UNKNOWN.",
      ["KEY_A"],
    ),
    false,
  );
  assert.equal(
    expectedMissingEnvironment(
      "Required environment variables are not set: STRIPE_SECRET_KEY.",
      [],
    ),
    false,
  );
  assert.equal(
    expectedMissingEnvironment("Build failed: STRIPE_SECRET_KEY", [
      "STRIPE_SECRET_KEY",
    ]),
    false,
  );
  assert.equal(
    expectedMissingEnvironment(undefined, ["STRIPE_SECRET_KEY"]),
    false,
  );
});
