import "./test-safety.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test("shutdown waits for an unreferenced child ignoring SIGINT to close", async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "worktree-stop-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const servicesUrl = new URL("./services.mjs", import.meta.url).href;
  // A separate process leaves no test runner handles to keep shutdown alive.
  const program = `
    import { spawn } from 'node:child_process';
    import fs from 'node:fs/promises';
    import { stopChildren } from ${JSON.stringify(servicesUrl)};
    const child = spawn(process.execPath, ['-e',
      "process.on('SIGINT',()=>{});setInterval(()=>{},1000);require('node:fs').writeFileSync('ready','ready')"
    ], { detached: true, stdio: 'ignore' });
    const deadline = Date.now() + 3000;
    while (!(await fs.access('ready').then(() => true, () => false))) {
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        throw new Error('Child did not become ready');
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    child.unref();
    await stopChildren([child]);
    console.log('stopped', child.signalCode);
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", program],
    { cwd: directory, encoding: "utf8", timeout: 10000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim(), "stopped SIGKILL");
});
