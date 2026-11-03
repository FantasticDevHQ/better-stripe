import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { decide, validateAssociation } from "./probe-sandbox.mjs";

it.each(["invalid", "2020-01-01", undefined])(
  "refuses invalid or expired association: %s",
  (expires_at) => {
    expect(() =>
      validateAssociation({ account_id: "acct_fixture", expires_at }),
    ).toThrow("invalid or expired");
  },
);

it("keeps API, event and cleanup failures distinct and blocks incompatible example keys", () => {
  const fail = { status: "fail" };
  const report = decide({
    results: { connect: fail },
    webhooks: { connect: fail },
    cleanup: { connect: fail },
    existingAdminGuardAcceptsKey: false,
  });
  expect(report.blockers).toEqual([
    "api:connect",
    "webhook:connect",
    "cleanup:connect",
    "example:test_key_guard",
  ]);
  expect(report.decision).toBe("blocked");
});

it("only recommends integration after all checks pass", () => {
  const pass = { status: "pass" };
  expect(
    decide({
      results: { account: pass },
      webhooks: { snapshot: pass },
      cleanup: {},
      existingAdminGuardAcceptsKey: true,
    }).decision,
  ).toBe("candidate_for_example_integration");
});

it("does not print a CLI exception or its captured private output", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "bts327-"));
  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./probe-sandbox.mjs", import.meta.url))],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, STRIPE_PROBE_CLI: "/missing/rkcs_test_private" },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Sandbox probe failed");
    expect(result.stdout + result.stderr).not.toMatch(
      /rkcs_test_private|ENOENT|spawnSync/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
