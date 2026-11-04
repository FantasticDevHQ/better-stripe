import "./test-safety.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("the installed runner executes only the explicitly selected consumer profile", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "bts-profile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts"));
  await writeFile(
    path.join(root, "scripts/worktree.config.json"),
    JSON.stringify({
      convex: false,
      frontend: false,
      profiles: {
        example: {
          hooks: {
            afterPrepare: [
              {
                name: "consumer-context",
                command: [
                  process.execPath,
                  "-e",
                  "require('node:fs').writeFileSync('context.json', process.env.WORKTREE_CONTEXT)",
                ],
              },
            ],
          },
        },
      },
    }),
  );
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./cli.mjs", import.meta.url)), ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          WORKTREE_REGISTRY_DIR: path.join(root, "registry"),
          GIT_CEILING_DIRECTORIES: path.dirname(root),
        },
      },
    );
  const ordinary = run("setup");
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.equal(existsSync(path.join(root, "context.json")), false);
  const selected = run("setup", "--profile", "example");
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(
    existsSync(path.join(root, "context.json")),
    true,
    "selected profile must execute the consumer hook",
  );
  const context = JSON.parse(
    await readFile(path.join(root, "context.json"), "utf8"),
  );
  assert.equal(context.profile, "example");
  assert.equal(context.phase, "afterPrepare");
  assert.equal(context.root, root);
});
