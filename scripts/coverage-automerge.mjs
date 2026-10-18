import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual, promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  budgetsPath,
  proposeCoverageBudgets,
  summaryPath,
} from "./check-coverage.mjs";
const execute = promisify(execFile);
const command = async (args) => (await execute("gh", args)).stdout;
const branch = "codex/coverage-ratchet";

function validateIdentity(repository, actor) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    !/^[\w-]+\[bot\]$/.test(actor ?? "")
  )
    throw new Error("Repository and coverage PR app actor are required.");
}

async function readCoveragePr({
  repository,
  actor,
  prNumber,
  expectedHead,
  run,
}) {
  validateIdentity(repository, actor);
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0)
    throw new Error("A coverage PR number is required.");
  const api = async (path) =>
    JSON.parse(await run(["api", `repos/${repository}/${path}`]));
  const pr = await api(`pulls/${prNumber}`);
  if (
    pr.base?.ref !== "main" ||
    pr.base.repo?.full_name !== repository ||
    pr.head?.repo?.full_name !== repository ||
    pr.head.ref !== branch ||
    pr.user?.login !== actor ||
    pr.draft ||
    !/^[a-f0-9]{40}$/.test(pr.head.sha ?? "") ||
    !/^[a-f0-9]{40}$/.test(pr.base.sha ?? "") ||
    (expectedHead !== undefined && pr.head.sha !== expectedHead)
  )
    throw new Error("Refusing an unexpected coverage PR identity or head.");
  if (pr.state === "closed") return null;
  if (pr.state !== "open") throw new Error("Unexpected coverage PR state.");
  const files = await api(`pulls/${prNumber}/files?per_page=2`);
  if (
    pr.changed_files !== 1 ||
    !Array.isArray(files) ||
    files.length !== 1 ||
    files[0].filename !== budgetsPath ||
    files[0].status !== "modified"
  )
    throw new Error("Coverage PR must modify only the coverage budget file.");
  return { pr, api };
}

export async function prepareCoveragePullRequest({
  repository,
  actor,
  command: run = command,
}) {
  validateIdentity(repository, actor);
  const prs = JSON.parse(
    await run([
      "pr",
      "list",
      "--repo",
      repository,
      "--base",
      "main",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number",
    ]),
  );
  if (!Array.isArray(prs) || prs.length > 1)
    throw new Error("Unexpected coverage PR list.");
  for (const pr of prs)
    await readCoveragePr({ repository, actor, prNumber: pr.number, run });
}

export async function enableCoverageAutoMerge({
  repository,
  actor,
  prNumber,
  expectedHead,
  totals,
  command: run = command,
}) {
  if (!/^[a-f0-9]{40}$/.test(expectedHead ?? ""))
    throw new Error("Expected coverage PR head is required.");
  const saved = await readCoveragePr({
    repository,
    actor,
    prNumber,
    expectedHead,
    run,
  });
  if (!saved) return "closed";
  const readBudget = async (sha) => {
    const file = await saved.api(`contents/${budgetsPath}?ref=${sha}`);
    if (file.encoding !== "base64" || typeof file.content !== "string")
      throw new Error("Coverage budget content unavailable.");
    return JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  };
  const before = await readBudget(saved.pr.base.sha);
  const proposed = proposeCoverageBudgets(before, totals);
  const after = await readBudget(expectedHead);
  if (
    isDeepStrictEqual(before, proposed) ||
    !isDeepStrictEqual(after, proposed)
  )
    throw new Error("Coverage PR differs from the measured eligible proposal.");
  await run([
    "pr",
    "merge",
    String(prNumber),
    "--repo",
    repository,
    "--auto",
    "--squash",
    "--match-head-commit",
    expectedHead,
  ]);
  return "enabled";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const options = {
      repository: process.env.GITHUB_REPOSITORY,
      actor: process.env.COVERAGE_RATCHET_ACTOR,
    };
    if (process.argv.length === 3 && process.argv[2] === "--preflight")
      await prepareCoveragePullRequest(options);
    else if (process.argv.length === 2) {
      const result = await enableCoverageAutoMerge({
        ...options,
        prNumber: Number(process.env.COVERAGE_RATCHET_PR),
        expectedHead: process.env.COVERAGE_RATCHET_HEAD,
        totals: JSON.parse(readFileSync(summaryPath, "utf8")).total,
      });
      console.log(`Coverage auto-merge: ${result}.`);
    } else throw new Error("Expected no arguments or --preflight.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
