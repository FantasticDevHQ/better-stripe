import { mkdtemp, realpath, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const script = fileURLToPath(new URL("./cli.mjs", import.meta.url));
export async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "worktree-test-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const registry = join(dir, "registry");
  async function run(root, ...args) {
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [script, ...args], {
        cwd: root,
        env: { ...process.env, WORKTREE_REGISTRY_DIR: registry },
      });
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("exit", (code) => resolve({ code, output }));
    });
  }
  async function root(name) {
    const path = join(dir, name);
    await mkdir(path);
    await writeFile(join(path, "convex.json"), "{}");
    return path;
  }
  return { dir, registry, run, root };
}
