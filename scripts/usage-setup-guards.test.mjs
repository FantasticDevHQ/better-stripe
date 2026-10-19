import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

for (const name of [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
]) {
  it(`rejects ${name} before invoking package or native commands without exposing its value`, () => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/verify-packed-usage-wiring.mjs",
        "dev:fixture",
        "/tmp/unused-evidence.json",
      ],
      {
        env: { ...process.env, PATH: "", [name]: "private-sentinel" },
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Remove ambient Convex overrides");
    expect(result.stderr).not.toContain("private-sentinel");
  });
}

const setup = readFileSync("docs/metering-setup.md", "utf8");
const secretCommand = setup
  .split("node --input-type=module -e '\n")[1]
  ?.split("\n'")[0];
for (const key of ["", "sk_live_privateSentinel", "sk_test_privateSentinel"]) {
  it(`does not print or pass a secret as an argument when setup fails for ${key ? "a supplied key" : "an empty read"}`, () => {
    expect(secretCommand).toBeTruthy();
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", secretCommand],
      {
        env: { ...process.env, PATH: "", STRIPE_SECRET_KEY: key },
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("privateSentinel");
    expect(result.stderr).toContain(
      key.startsWith("sk_test_")
        ? "Sandbox environment update failed"
        : "A nonempty Stripe sandbox secret is required",
    );
  });
}
