import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertExternalTmpdir } from "./test-safety.mjs";

test("fixture temp directories inside a checkout fail before cleanup can select parent state", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "fixture-safety-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nested = path.join(root, "ignored/tmp");
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(root, ".git"), "gitdir: external");
  assert.throws(() => assertExternalTmpdir(nested), /outside.*checkout/);
  await rm(path.join(root, ".git"));
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "scripts/worktree.config.json"), "{}");
  assert.throws(() => assertExternalTmpdir(nested), /outside.*checkout/);
  assert.doesNotThrow(() => assertExternalTmpdir(path.dirname(root)));
});
