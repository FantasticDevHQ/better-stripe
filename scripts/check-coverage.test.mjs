import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const roots = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "coverage-ratchet-"));
  roots.push(root);
  mkdirSync(join(root, "gates"));
  mkdirSync(join(root, "coverage"));
  writeFileSync(
    join(root, "repo-gates.config.json"),
    JSON.stringify({
      coverage: { summaryGlobs: ["coverage/coverage-summary.json"] },
    }),
  );
  const budgets = {
    _comment: "Keep this policy",
    default: { lines: 80, functions: 80 },
    packages: {
      "coverage/coverage-summary.json": { lines: 77.4, functions: 72.52 },
    },
  };
  writeFileSync(
    join(root, "gates/coverage-budgets.json"),
    JSON.stringify(budgets, null, 2) + "\n",
  );
  return {
    root,
    budgets,
    read: () => readFileSync(join(root, "gates/coverage-budgets.json"), "utf8"),
  };
}
function successfulRun(root, lines = 79, functions = 75) {
  return () => {
    writeFileSync(
      join(root, "coverage/coverage-summary.json"),
      JSON.stringify({
        total: { lines: { pct: lines }, functions: { pct: functions } },
      }),
    );
    return 0;
  };
}
async function run(options) {
  const module = await import("./check-coverage.mjs").catch(() => ({}));
  expect(
    module.checkCoverage,
    "coverage checks must automatically ratchet floors",
  ).toBeTypeOf("function");
  return module.checkCoverage(options);
}

it("persists improvements after a successful full check while preserving policy metadata", async () => {
  const f = fixture();
  expect(
    await run({ root: f.root, ci: false, runCheck: successfulRun(f.root) }),
  ).toBe(0);
  expect(JSON.parse(f.read())).toEqual({
    ...f.budgets,
    packages: {
      "coverage/coverage-summary.json": { lines: 78.5, functions: 74.5 },
    },
  });
});
it("raises metrics independently and never lowers an existing floor", async () => {
  const f = fixture();
  expect(
    await run({
      root: f.root,
      ci: false,
      runCheck: successfulRun(f.root, 77.6, 76),
    }),
  ).toBe(0);
  expect(
    JSON.parse(f.read()).packages["coverage/coverage-summary.json"],
  ).toEqual({ lines: 77.4, functions: 75.5 });
});
it("does not rewrite unchanged budgets", async () => {
  const f = fixture(),
    before = f.read();
  expect(
    await run({
      root: f.root,
      ci: false,
      runCheck: successfulRun(f.root, 77.9, 73.02),
    }),
  ).toBe(0);
  expect(f.read()).toBe(before);
});
it("leaves budgets untouched after a failed check even if a summary was emitted", async () => {
  const f = fixture(),
    before = f.read();
  expect(
    await run({
      root: f.root,
      ci: false,
      runCheck: () => {
        successfulRun(f.root, 95, 95)();
        return 7;
      },
    }),
  ).toBe(7);
  expect(f.read()).toBe(before);
});
it("requires CI improvements to be committed without changing its checkout", async () => {
  const f = fixture(),
    before = f.read();
  expect(
    await run({ root: f.root, ci: true, runCheck: successfulRun(f.root) }),
  ).toBe(1);
  expect(f.read()).toBe(before);
});
it("passes CI when the floors already reflect the measured baseline", async () => {
  const f = fixture();
  expect(
    await run({
      root: f.root,
      ci: true,
      runCheck: successfulRun(f.root, 77.9, 73.02),
    }),
  ).toBe(0);
});
it.each([-1, 101, null, "90"])(
  "rejects invalid percentages (%s) without writing budgets",
  async (pct) => {
    const f = fixture(),
      before = f.read();
    await expect(
      run({
        root: f.root,
        ci: false,
        runCheck: successfulRun(f.root, pct, 95),
      }),
    ).rejects.toThrow(/percentage/);
    expect(f.read()).toBe(before);
  },
);
it("fails closed if the configured summary locations change", async () => {
  const f = fixture(),
    before = f.read();
  writeFileSync(
    join(f.root, "repo-gates.config.json"),
    JSON.stringify({
      coverage: { summaryGlobs: ["packages/*/coverage/coverage-summary.json"] },
    }),
  );
  await expect(
    run({ root: f.root, ci: false, runCheck: successfulRun(f.root) }),
  ).rejects.toThrow(/summary/);
  expect(f.read()).toBe(before);
});
