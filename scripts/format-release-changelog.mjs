#!/usr/bin/env node
// Format the generated release PR with the same pinned Prettier used by CI.
import { pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";

function publicChangelog(source) {
  return source
    .replace(
      /\[([^\]]*)\]\(https?:\/\/(?:www\.)?linear\.app\/[^\s)]*\)/gi,
      "$1",
    )
    .replace(
      /[ \t]*\([ \t]*https?:\/\/(?:www\.)?linear\.app\/[^\s)]*[ \t]*\)/gi,
      "",
    )
    .replace(/https?:\/\/(?:www\.)?linear\.app\/[^\s)]*/gi, "")
    .replace(/[ \t]*\([ \t]*BTS(?:-\d+)?[ \t]*\)/gi, "")
    .replace(/[ \t]*\bBTS(?:-\d+)?\b/gi, "");
}

export async function formatReleaseChangelog({
  repository,
  prNumber,
  token,
  request = fetch,
  apiUrl = "https://api.github.com",
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    !Number.isSafeInteger(prNumber) ||
    prNumber <= 0 ||
    !token
  )
    throw new Error(
      "Repository, release PR number, and GitHub App token are required.",
    );
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const api = async (path, options = {}) => {
    const response = await request(`${apiUrl}/repos/${repository}/${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    if (!response.ok)
      throw new Error(`GitHub request failed with status ${response.status}`);
    return response.json();
  };
  const pr = await api(`pulls/${prNumber}`);
  if (pr.state !== "open") return false;
  if (
    pr.base.ref !== "main" ||
    pr.head.repo?.full_name !== repository ||
    !pr.head.ref.startsWith("release-please--")
  )
    throw new Error(
      "Refusing to format a PR outside the generated release PR branch.",
    );
  const file = await api(
    `contents/CHANGELOG.md?ref=${encodeURIComponent(pr.head.ref)}`,
  );
  if (
    file.encoding !== "base64" ||
    !file.sha ||
    typeof file.content !== "string"
  )
    throw new Error("Release changelog content is unavailable.");
  const original = Buffer.from(file.content, "base64").toString("utf8");
  const formatted = await format(publicChangelog(original), {
    ...(await resolveConfig("CHANGELOG.md")),
    filepath: "CHANGELOG.md",
  });
  if (formatted === original) return false;
  await api("contents/CHANGELOG.md", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: format release changelog",
      branch: pr.head.ref,
      sha: file.sha,
      content: Buffer.from(formatted).toString("base64"),
    }),
  });
  return true;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const pr = JSON.parse(process.env.RELEASE_PR ?? "null");
    const changed = await formatReleaseChangelog({
      repository: process.env.GITHUB_REPOSITORY,
      prNumber: pr?.number,
      token: process.env.GH_TOKEN,
      apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
    });
    console.log(
      changed
        ? "Committed formatted release changelog."
        : "No changelog formatting commit needed.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
