import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const cli = fileURLToPath(new URL("./sandbox-pool-cli.mjs", import.meta.url));
it("explains registration without requiring JSON or a secret argument", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("register --name <sandbox-name>");
  expect(result.stdout).toContain("hidden prompt");
});
it("fails noninteractive registration with an actionable private-file instruction", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "register", "--name", "dev-a"],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--key-file");
});

it("reports invalid key types without printing the supplied key", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "stripe-key-input-"));
  try {
    const file = path.join(directory, "key");
    writeFileSync(file, "sk_live_private", { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [cli, "register", "--name", "dev-a", "--key-file", file],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Use a full test secret key (sk_test_)");
    expect(result.stdout + result.stderr).not.toContain("sk_live_private");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
