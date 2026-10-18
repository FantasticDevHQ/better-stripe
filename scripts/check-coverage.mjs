import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const summaryPath = "coverage/coverage-summary.json";
export const budgetsPath = "gates/coverage-budgets.json";
const metrics = ["lines", "functions"];
const margin = 0.5;
const minimumIncrease = 0.05;

function percentage(value, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  )
    throw new Error(`${label} must be a percentage in [0, 100]`);
  return value;
}

function validateCoverage(budgets, totals) {
  const floor = budgets.packages?.[summaryPath];
  if (!floor) throw new Error(`Missing coverage floors for ${summaryPath}`);
  for (const metric of metrics) {
    const current = percentage(floor[metric], `${metric} floor`);
    const measured = percentage(totals?.[metric]?.pct, `${metric} coverage`);
    if (measured < current)
      throw new Error(`${metric} coverage is below its floor`);
  }
}

export function proposeCoverageBudgets(budgets, totals) {
  validateCoverage(budgets, totals);
  const proposed = structuredClone(budgets);
  const floor = proposed.packages[summaryPath];
  for (const metric of metrics) {
    // Integer hundredths avoid rejecting an exact 0.05 gain through float error.
    // Round coverage down so the proposal retains the entire safety margin.
    const earned = Math.max(
      0,
      Math.floor(totals[metric].pct * 100 + 1e-9) - margin * 100,
    );
    const current = Math.round(floor[metric] * 100);
    if (earned - current >= minimumIncrease * 100) floor[metric] = earned / 100;
  }
  return proposed;
}

export function checkCoverage({
  root,
  ratchet = false,
  runCheck,
  reportPath,
  runUrl,
}) {
  const config = JSON.parse(
    readFileSync(resolve(root, "repo-gates.config.json"), "utf8"),
  );
  if (
    JSON.stringify(config.coverage?.summaryGlobs) !==
    JSON.stringify([summaryPath])
  )
    throw new Error(
      "Update the coverage ratchet to handle the configured summary locations.",
    );
  // A previous report must never authorize a new floor, even if a runner exits
  // successfully without generating its expected fresh full-coverage report.
  rmSync(resolve(root, summaryPath), { force: true });
  const status = runCheck();
  if (status !== 0) return status;
  const budgetsFile = resolve(root, budgetsPath);
  const original = readFileSync(budgetsFile, "utf8");
  const budgets = JSON.parse(original);
  const totals = JSON.parse(
    readFileSync(resolve(root, summaryPath), "utf8"),
  ).total;
  validateCoverage(budgets, totals);
  if (!ratchet) return 0;
  const proposed = proposeCoverageBudgets(budgets, totals);
  const changed = metrics.some(
    (metric) =>
      proposed.packages[summaryPath][metric] >
      budgets.packages[summaryPath][metric],
  );
  if (changed)
    writeFileSync(budgetsFile, `${JSON.stringify(proposed, null, 2)}\n`);
  if (reportPath) {
    const rows = metrics.map(
      (metric) =>
        `| ${metric} | ${totals[metric].pct.toFixed(2)}% | ${budgets.packages[summaryPath][metric].toFixed(2)}% | ${proposed.packages[summaryPath][metric].toFixed(2)}% |`,
    );
    writeFileSync(
      reportPath,
      [
        "Weekly coverage floor update after a successful full repository gate run.",
        "",
        "Each changed metric gains at least 0.05 percentage points and retains the 0.5-point margin. Existing floors never decrease.",
        "",
        "| Metric | Measured | Previous floor | Proposed floor |",
        "| --- | --- | --- | --- |",
        ...rows,
        "",
        ...(runUrl ? [`[Full gate evidence](${runUrl})`, ""] : []),
      ].join("\n"),
    );
  }
  console.log(
    changed
      ? "Coverage floors raised for the scheduled PR."
      : "No coverage improvement reaches the 0.05-point minimum.",
  );
  return 0;
}

export function coverageCommand(args) {
  if (args.length === 0) return ["exec", "repo-gates", "check-coverage"];
  if (args.length === 1 && args[0] === "--ratchet") return ["run", "check:all"];
  throw new Error(
    "Coverage arguments must be empty or --ratchet; partial or skipped runs cannot update floors.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = coverageCommand(process.argv.slice(2));
    const root = fileURLToPath(new URL("../", import.meta.url));
    process.exitCode = checkCoverage({
      root,
      ratchet: process.argv[2] === "--ratchet",
      reportPath: process.env.COVERAGE_RATCHET_REPORT,
      runUrl: process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : undefined,
      runCheck: () => {
        const result = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
        if (result.error) throw result.error;
        return result.status ?? 1;
      },
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
