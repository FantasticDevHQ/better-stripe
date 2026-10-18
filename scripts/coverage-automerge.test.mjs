import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
const repository = "FantasticDevHQ/better-stripe";
const actor = "coverage-app[bot]";
const head = "a".repeat(40),
  base = "b".repeat(40);
const before = {
  default: { lines: 80, functions: 80 },
  packages: {
    "coverage/coverage-summary.json": { lines: 81.45, functions: 77.34 },
  },
};
const after = structuredClone(before);
after.packages["coverage/coverage-summary.json"] = {
  lines: 81.5,
  functions: 77.44,
};
const totals = { lines: { pct: 82 }, functions: { pct: 77.94 } };
function fixture() {
  const pr = {
    number: 12,
    state: "open",
    draft: false,
    changed_files: 1,
    user: { login: actor },
    base: { ref: "main", sha: base, repo: { full_name: repository } },
    head: {
      ref: "codex/coverage-ratchet",
      sha: head,
      repo: { full_name: repository },
    },
  };
  const files = [
    { filename: "gates/coverage-budgets.json", status: "modified" },
  ];
  const budgets = structuredClone(after);
  const command = vi.fn(async (args) => {
    if (args[0] === "pr" && args[1] === "list")
      return JSON.stringify([{ number: 12 }]);
    if (args[0] === "pr" && args[1] === "merge") return "";
    const path = args[1];
    if (path.endsWith("/pulls/12")) return JSON.stringify(pr);
    if (path.includes("/files?")) return JSON.stringify(files);
    if (path.includes("contents/"))
      return JSON.stringify({
        encoding: "base64",
        content: Buffer.from(
          JSON.stringify(path.endsWith(base) ? before : budgets),
        ).toString("base64"),
      });
    throw new Error(`Unexpected command ${JSON.stringify(args)}`);
  });
  const run = async (overrides = {}) =>
    (await import("./coverage-automerge.mjs")).enableCoverageAutoMerge({
      repository,
      actor,
      prNumber: 12,
      expectedHead: head,
      totals,
      command,
      ...overrides,
    });
  const preflight = async () =>
    (await import("./coverage-automerge.mjs")).prepareCoveragePullRequest({
      repository,
      actor,
      command,
    });
  return { pr, files, budgets, command, run, preflight };
}
it("enables protected auto-merge only for the measured budget-only proposal at its exact head", async () => {
  const f = fixture();
  expect(await f.run()).toBe("enabled");
  expect(f.command).toHaveBeenLastCalledWith([
    "pr",
    "merge",
    "12",
    "--repo",
    repository,
    "--auto",
    "--squash",
    "--match-head-commit",
    head,
  ]);
});
it.each(["actor", "branch", "repository", "base", "head", "draft"])(
  "rejects an unexpected %s before any merge",
  async (field) => {
    const f = fixture();
    if (field === "actor") f.pr.user.login = "human";
    if (field === "branch") f.pr.head.ref = "codex/unrelated";
    if (field === "repository") f.pr.head.repo.full_name = "fork/repo";
    if (field === "base") f.pr.base.ref = "develop";
    if (field === "head") f.pr.head.sha = "c".repeat(40);
    if (field === "draft") f.pr.draft = true;
    await expect(f.run()).rejects.toThrow(/coverage PR/);
    expect(f.command.mock.calls.some(([args]) => args[1] === "merge")).toBe(
      false,
    );
  },
);
it("refuses extra files before refreshing a managed branch or enabling merge", async () => {
  const f = fixture();
  f.pr.changed_files = 2;
  f.files.push({ filename: "src/money.ts", status: "modified" });
  await expect(f.preflight()).rejects.toThrow(/budget/);
  await expect(f.run()).rejects.toThrow(/budget/);
});
it("refuses renamed files and formatting-only proposals", async () => {
  const f = fixture();
  f.files[0].status = "renamed";
  await expect(f.run()).rejects.toThrow(/budget/);
  f.files[0].status = "modified";
  f.budgets.packages = structuredClone(before.packages);
  await expect(f.run()).rejects.toThrow(/proposal/);
});
it.each(["metadata", "decrease", "unearned", "tiny"])(
  "rejects a %s change even in a budget-only PR",
  async (change) => {
    const f = fixture();
    if (change === "metadata") f.budgets.default.lines = 0;
    if (change === "decrease")
      f.budgets.packages["coverage/coverage-summary.json"].lines = 81.4;
    if (change === "unearned")
      f.budgets.packages["coverage/coverage-summary.json"].lines = 90;
    if (change === "tiny")
      f.budgets.packages["coverage/coverage-summary.json"].lines = 81.46;
    await expect(f.run()).rejects.toThrow(/proposal/);
  },
);
it("does not retry a head change or bypass branch protection", async () => {
  const f = fixture();
  const original = f.command.getMockImplementation();
  f.command.mockImplementation(async (args) => {
    if (args[1] === "merge")
      throw new Error("expected head oid does not match current head oid");
    return original(args);
  });
  await expect(f.run()).rejects.toThrow(/head oid/);
  expect(
    f.command.mock.calls.filter(([args]) => args[1] === "merge"),
  ).toHaveLength(1);
});
it("can refresh one app-owned coverage-only PR and does nothing when none exists", async () => {
  const f = fixture();
  await expect(f.preflight()).resolves.toBeUndefined();
  f.command.mockReset().mockResolvedValue("[]");
  await expect(f.preflight()).resolves.toBeUndefined();
  expect(f.command).toHaveBeenCalledTimes(1);
});
it("does not merge an already closed PR", async () => {
  const f = fixture();
  f.pr.state = "closed";
  expect(await f.run()).toBe("closed");
  expect(f.command).toHaveBeenCalledTimes(1);
});
it("wires a weekly main-only workflow to fresh full checks and a single budget-only app PR", () => {
  const workflow = readFileSync(
    ".github/workflows/coverage-ratchet.yml",
    "utf8",
  );
  expect(workflow).toContain('cron: "17 2 * * 1"');
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain("node scripts/check-coverage.mjs --ratchet");
  expect(workflow).toContain("add-paths: gates/coverage-budgets.json");
  expect(workflow).toContain("token: ${{ steps.app-token.outputs.token }}");
  expect(workflow).toContain(
    "COVERAGE_RATCHET_HEAD: ${{ steps.pr.outputs.pull-request-head-sha }}",
  );
  expect(workflow).toContain("node scripts/coverage-automerge.mjs --preflight");
});
