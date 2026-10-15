#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
const execute = promisify(execFile);
const command = async (args) => (await execute("gh", args)).stdout;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry only GitHub's explicit stale-head rejection, always matching a fresh head. */
export async function enableReleaseAutoMerge({
  repository,
  prNumber,
  command: run = command,
  wait: pause = wait,
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    !Number.isSafeInteger(prNumber) ||
    prNumber <= 0
  )
    throw new Error("Repository and release PR number are required.");
  let releaseBranch;
  for (let attempt = 0; attempt < 3; attempt++) {
    const pr = JSON.parse(
      await run(["api", `repos/${repository}/pulls/${prNumber}`]),
    );
    if (
      pr.base?.ref !== "main" ||
      pr.base.repo?.full_name !== repository ||
      pr.head?.repo?.full_name !== repository ||
      !pr.head.ref?.startsWith("release-please--") ||
      (releaseBranch !== undefined && pr.head.ref !== releaseBranch) ||
      !/^[0-9a-f]{40}$/.test(pr.head.sha ?? "")
    )
      throw new Error("Refusing to merge an unexpected generated release PR.");
    releaseBranch = pr.head.ref;
    if (pr.state === "closed") return pr.merged ? "merged" : "closed";
    if (pr.state !== "open")
      throw new Error("Unexpected generated release PR state.");
    try {
      await run([
        "pr",
        "merge",
        String(prNumber),
        "--repo",
        repository,
        "--auto",
        "--squash",
        "--match-head-commit",
        pr.head.sha,
      ]);
      return "enabled";
    } catch (error) {
      if (
        attempt === 2 ||
        !/expected head oid does not match (?:the )?current head oid/i.test(
          typeof error.stderr === "string" ? error.stderr : "",
        )
      )
        throw error;
      await pause(2000);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const pr = JSON.parse(process.env.RELEASE_PR ?? "null");
    const result = await enableReleaseAutoMerge({
      repository: process.env.GITHUB_REPOSITORY,
      prNumber: pr?.number,
    });
    console.log(`Release auto-merge: ${result}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
