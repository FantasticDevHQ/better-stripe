import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { probeCapabilities } from "./sandbox-capabilities.mjs";
import { withWebhookProbe } from "./sandbox-webhooks.mjs";

// Explicit developer probe. Never called by worktree setup/start or package install.
async function main() {
  const directory = path.resolve(".worktree/stripe-probe");
  const cli = process.env.STRIPE_PROBE_CLI || "stripe";
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const config = path.join(directory, "config.toml");
  const credentials = path.join(directory, "credentials.private.json");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("STRIPE_")),
  );
  env.BROWSER = "false";
  let sandbox;
  try {
    const metadata = await stat(credentials);
    if (metadata.mode & 0o077)
      throw new Error("Credentials require owner-only permissions");
    sandbox = JSON.parse(await readFile(credentials, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      await stat(config);
      throw new Error(
        "Use a clean probe directory without an existing CLI profile",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const raw = execFileSync(
      cli,
      [
        "--config",
        config,
        "sandbox",
        "create",
        "--from-git",
        "--non-interactive",
      ],
      {
        env,
        encoding: "utf8",
        timeout: 180000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const match = raw.match(/\{\s*"secret_key"[\s\S]*?\n\}/);
    if (!match)
      throw new Error(
        "CLI did not return sandbox credentials; browser fallback is not a successful probe",
      );
    sandbox = JSON.parse(match[0]);
    await writeFile(credentials, JSON.stringify(sandbox), {
      mode: 0o600,
      flag: "wx",
    });
  }
  validateAssociation(sandbox);
  const report = await withWebhookProbe({
    cli,
    config,
    run: () => probeCapabilities(sandbox.secret_key),
  });
  report.observedAt = new Date().toISOString();
  report.cliVersion = execFileSync(cli, ["version"], {
    env,
    encoding: "utf8",
  }).trim();
  report.expiresAt = sandbox.expires_at;
  decide(report);
  report.limitations = [
    "Checkout session creation does not prove browser payment completion.",
    "A rejected transfer or payout is not a successful money movement test.",
    "The existing example test-key guard is observed, not changed by this probe.",
    "Test objects remain in this temporary sandbox until expiry; cleanup results are reported separately.",
  ];
  await writeFile(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
}

export function validateAssociation(sandbox) {
  if (
    !sandbox.account_id ||
    !sandbox.expires_at ||
    !Number.isFinite(Date.parse(sandbox.expires_at)) ||
    Date.parse(sandbox.expires_at) <= Date.now()
  )
    throw new Error(
      "Sandbox association is invalid or expired; use a fresh isolated probe directory",
    );
}

export function decide(report) {
  const failures = Object.entries({
    ...Object.fromEntries(
      Object.entries(report.results).map(([name, result]) => [
        `api:${name}`,
        result,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(report.webhooks).map(([name, result]) => [
        `webhook:${name}`,
        result,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(report.cleanup).map(([name, result]) => [
        `cleanup:${name}`,
        result,
      ]),
    ),
  })
    .filter(([, result]) => result.status !== "pass")
    .map(([name]) => name);
  if (!report.existingAdminGuardAcceptsKey)
    failures.push("example:test_key_guard");
  report.decision = failures.length
    ? "blocked"
    : "candidate_for_example_integration";
  report.blockers = failures;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Sandbox probe failed. Check CLI availability and private worktree state. No provider output is printed.",
    );
    process.exitCode = 1;
  });
