import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const summaryPath = "coverage/coverage-summary.json";
const budgetsPath = "gates/coverage-budgets.json";
const metrics = ["lines", "functions"];
const margin = 0.5;

function percentage(value, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new Error(`${label} must be a percentage in [0, 100]`);
  }
  return value;
}

export function checkCoverage({ root, ci, runCheck }) {
  const config = JSON.parse(
    readFileSync(resolve(root, "repo-gates.config.json"), "utf8"),
  );
  if (
    JSON.stringify(config.coverage?.summaryGlobs) !==
    JSON.stringify([summaryPath])
  ) {
    throw new Error(
      "Update the coverage ratchet to handle the configured summary locations.",
    );
  }
  // Always run the existing full gate first. Failed tests, missing reports, and
  // regressions must never modify the committed floors.
  const status = runCheck();
  if (status !== 0) return status;
  const budgetsFile = resolve(root, budgetsPath);
  const original = readFileSync(budgetsFile, "utf8");
  const budgets = JSON.parse(original);
  const totals = JSON.parse(
    readFileSync(resolve(root, summaryPath), "utf8"),
  ).total;
  const floor = budgets.packages?.[summaryPath];
  if (!floor) throw new Error(`Missing coverage floors for ${summaryPath}`);
  let changed = false;
  for (const metric of metrics) {
    const current = percentage(floor[metric], `${metric} floor`);
    const measured = percentage(totals?.[metric]?.pct, `${metric} coverage`);
    const candidate = Math.max(0, Math.round((measured - margin) * 100) / 100);
    floor[metric] = Math.max(current, candidate);
    changed ||= floor[metric] > current;
  }
  if (!changed) return 0;
  if (ci) {
    console.error(
      `Coverage improved. Run pnpm run check:coverage locally and commit ${budgetsPath}.`,
    );
    return 1;
  }
  writeFileSync(budgetsFile, `${JSON.stringify(budgets, null, 2)}\n`);
  console.log(
    `Coverage floors raised to ${floor.lines}% lines / ${floor.functions}% functions. Commit ${budgetsPath}.`,
  );
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // Do not forward --skip-run, --partial, or test filters. Only a fresh full
  // coverage check is eligible to ratchet the baseline.
  if (process.argv.length !== 2) {
    console.error(
      "Automatic coverage ratcheting requires a full check with no arguments.",
    );
    process.exitCode = 1;
  } else {
    try {
      const root = fileURLToPath(new URL("../", import.meta.url));
      process.exitCode = checkCoverage({
        root,
        ci: Boolean(
          process.env.CI &&
          process.env.CI !== "false" &&
          process.env.CI !== "0",
        ),
        runCheck: () => {
          const result = spawnSync(
            "pnpm",
            ["exec", "repo-gates", "check-coverage"],
            { cwd: root, stdio: "inherit" },
          );
          if (result.error) throw result.error;
          return result.status ?? 1;
        },
      });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
