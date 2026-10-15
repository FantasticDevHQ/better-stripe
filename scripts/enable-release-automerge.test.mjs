import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
const repository = "FantasticDevHQ/better-stripe";
const branch =
  "release-please--branches--main--components--@fantastic.dev/better-stripe";
const sha = (digit) => digit.repeat(40);
const pr = (head = sha("a")) => ({
  state: "open",
  merged: false,
  base: { ref: "main", repo: { full_name: repository } },
  head: { ref: branch, sha: head, repo: { full_name: repository } },
});
const stale = () =>
  Object.assign(new Error("merge rejected"), {
    stderr:
      "GraphQL: expected head oid does not match the current head oid (enablePullRequestAutoMerge)",
  });
async function feature() {
  const module = await import("./enable-release-automerge.mjs").catch(
    () => ({}),
  );
  expect(
    module.enableReleaseAutoMerge,
    "release auto-merge retry helper is missing",
  ).toBeTypeOf("function");
  return module.enableReleaseAutoMerge;
}
function setup() {
  const command = vi.fn();
  const wait = vi.fn().mockResolvedValue(undefined);
  return {
    command,
    wait,
    run: async (options = {}) =>
      (await feature())({
        repository,
        prNumber: 174,
        command,
        wait,
        ...options,
      }),
  };
}
it("re-reads the same release PR after a stale head and preserves exact-head matching", async () => {
  const { command, wait, run } = setup();
  command
    .mockResolvedValueOnce(JSON.stringify(pr()))
    .mockRejectedValueOnce(stale())
    .mockResolvedValueOnce(JSON.stringify(pr(sha("b"))))
    .mockResolvedValueOnce("");
  expect(await run()).toBe("enabled");
  expect(command.mock.calls).toEqual([
    [["api", `repos/${repository}/pulls/174`]],
    [
      [
        "pr",
        "merge",
        "174",
        "--repo",
        repository,
        "--auto",
        "--squash",
        "--match-head-commit",
        sha("a"),
      ],
    ],
    [["api", `repos/${repository}/pulls/174`]],
    [
      [
        "pr",
        "merge",
        "174",
        "--repo",
        repository,
        "--auto",
        "--squash",
        "--match-head-commit",
        sha("b"),
      ],
    ],
  ]);
  expect(wait).toHaveBeenCalledTimes(1);
});
it("bounds repeated stale-head failures to three merge attempts", async () => {
  const { command, wait, run } = setup();
  command.mockImplementation(async (args) => {
    if (args[0] === "api") return JSON.stringify(pr());
    throw stale();
  });
  await expect(run()).rejects.toThrow("merge rejected");
  expect(command).toHaveBeenCalledTimes(6);
  expect(wait).toHaveBeenCalledTimes(2);
});
it("does not retry unrelated errors or failed PR reads", async () => {
  const { command, wait, run } = setup();
  command
    .mockResolvedValueOnce(JSON.stringify(pr()))
    .mockRejectedValueOnce(new Error("permission denied"));
  await expect(run()).rejects.toThrow("permission denied");
  expect(command).toHaveBeenCalledTimes(2);
  expect(wait).not.toHaveBeenCalled();
  command.mockReset().mockRejectedValueOnce(new Error("API unavailable"));
  await expect(run()).rejects.toThrow("API unavailable");
  expect(command).toHaveBeenCalledTimes(1);
});
it.each([
  { ...pr(), head: { ...pr().head, ref: "main" } },
  { ...pr(), head: { ...pr().head, repo: { full_name: "other/repo" } } },
  { ...pr(), head: { ...pr().head, sha: "invalid" } },
  { ...pr(), base: { ...pr().base, ref: "develop" } },
  { ...pr(), base: { ...pr().base, repo: { full_name: "other/repo" } } },
])(
  "refuses an unexpected branch, repository, base or revision",
  async (data) => {
    const { command, run } = setup();
    command.mockResolvedValueOnce(JSON.stringify(data));
    await expect(run()).rejects.toThrow("generated release PR");
    expect(command).toHaveBeenCalledTimes(1);
  },
);
it("revalidates release branch identity after a head race", async () => {
  const { command, run } = setup();
  command
    .mockResolvedValueOnce(JSON.stringify(pr()))
    .mockRejectedValueOnce(stale())
    .mockResolvedValueOnce(
      JSON.stringify({ ...pr(), head: { ...pr().head, ref: "unrelated" } }),
    );
  await expect(run()).rejects.toThrow("generated release PR");
  expect(command).toHaveBeenCalledTimes(3);
});
it("pins the generated release branch across retries", async () => {
  const { command, run } = setup();
  command
    .mockResolvedValueOnce(JSON.stringify(pr()))
    .mockRejectedValueOnce(stale())
    .mockResolvedValueOnce(
      JSON.stringify({
        ...pr(),
        head: { ...pr().head, ref: "release-please--unexpected" },
      }),
    );
  await expect(run()).rejects.toThrow("generated release PR");
  expect(command).toHaveBeenCalledTimes(3);
});
it("accepts an already merged release without another merge operation", async () => {
  const { command, run } = setup();
  command.mockResolvedValueOnce(
    JSON.stringify({ ...pr(), state: "closed", merged: true }),
  );
  expect(await run()).toBe("merged");
  expect(command).toHaveBeenCalledTimes(1);
});
it("does not enable auto-merge for a closed, unmerged PR", async () => {
  const { command, run } = setup();
  command.mockResolvedValueOnce(JSON.stringify({ ...pr(), state: "closed" }));
  expect(await run()).toBe("closed");
  expect(command).toHaveBeenCalledTimes(1);
});
it("uses the tested retry helper in the release workflow", async () => {
  expect(await readFile(".github/workflows/release.yml", "utf8")).toContain(
    "node scripts/enable-release-automerge.mjs",
  );
});
it.each([
  { repository: "bad", prNumber: 174 },
  { repository, prNumber: 0 },
  { repository, prNumber: 1.5 },
])("rejects invalid invocation before external calls", async (options) => {
  const { command, run } = setup();
  await expect(run(options)).rejects.toThrow(
    "Repository and release PR number",
  );
  expect(command).not.toHaveBeenCalled();
});
