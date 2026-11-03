import "./test-safety.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

import { fixture, script } from "./test-fixture.mjs";

test("profile-selection, hook-order, literal-argv, worktree-context and setup-lock", async (t) => {
  const f = await fixture(t);
  const roots = [await f.root("profile-a"), await f.root("profile-b")];
  for (const root of roots) {
    await mkdir(join(root, "scripts"));
    await writeFile(
      join(root, "scripts/unlisted.mjs"),
      'throw new Error("must not run")',
    );
    const hook = (name) => ({
      name,
      command: [
        process.execPath,
        "-e",
        `const fs=require('node:fs'); const c=JSON.parse(process.env.WORKTREE_CONTEXT); fs.appendFileSync('events', JSON.stringify({name:${JSON.stringify(name)},c,arg:process.argv[1]})+'\\n');`,
        "; $(echo unsafe) &",
      ],
    });
    await writeFile(
      join(root, "scripts/worktree.config.json"),
      JSON.stringify({
        profiles: {
          example: { hooks: { afterPrepare: [hook("A"), hook("B")] } },
          docs: { hooks: { afterPrepare: [hook("docs")] } },
        },
      }),
    );
  }
  const results = await Promise.all(
    roots.flatMap((root) => [
      f.run(root, "setup", "--prepare-only", "--profile", "example"),
      f.run(root, "setup", "--prepare-only", "--profile", "example"),
    ]),
  );
  for (const r of results) assert.equal(r.code, 0, r.output);
  const events = await Promise.all(
    roots.map(async (root) =>
      (await readFile(join(root, "events"), "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse),
    ),
  );
  for (let i = 0; i < roots.length; i++) {
    assert.deepEqual(
      events[i].map((e) => e.name),
      ["A", "B", "A", "B"],
    );
    assert.equal(events[i][0].c.root, roots[i]);
    assert.equal(events[i][0].arg, "; $(echo unsafe) &");
    assert.ok(events[i][0].c.ports.cloud);
    assert.equal((await f.run(roots[i], "setup", "--prepare-only")).code, 0);
    assert.equal(
      (await readFile(join(roots[i], "events"), "utf8")).trim().split("\n")
        .length,
      4,
    );
  }
  assert.notEqual(events[0][0].c.id, events[1][0].c.id);
  assert.notEqual(events[0][0].c.ports.cloud, events[1][0].c.ports.cloud);
});

test("hook-failure and invalid-config stop later commands", async (t) => {
  const f = await fixture(t),
    root = await f.root("fail");
  await mkdir(join(root, "scripts"));
  const config = {
    profiles: {
      example: {
        hooks: {
          afterPrepare: [
            {
              name: "fail",
              command: [process.execPath, "-e", "process.exit(7)"],
            },
            {
              name: "later",
              command: [
                process.execPath,
                "-e",
                "require('node:fs').writeFileSync('later','bad')",
              ],
            },
          ],
        },
      },
    },
  };
  const file = join(root, "scripts/worktree.config.json");
  await writeFile(file, JSON.stringify(config));
  const r = await f.run(root, "setup", "--profile", "example");
  assert.notEqual(r.code, 0);
  assert.match(r.output, /example.*afterPrepare\/fail.*7/);
  await assert.rejects(readFile(join(root, "later")), { code: "ENOENT" });
  assert.match(
    (await f.run(root, "setup", "--profile", "missing")).output,
    /configuration.*unknown profile/,
  );
  config.profiles.example.hooks.afterPrepare[0].command = [];
  await writeFile(file, JSON.stringify(config));
  assert.match(
    (await f.run(root, "setup")).output,
    /configuration.*invalid hook/,
  );
});

test("phase-order: bootstrap then two scripts then environment import and push", async (t) => {
  const f = await fixture(t),
    root = await f.root("import");
  await mkdir(join(root, "scripts/example"), { recursive: true });
  await mkdir(join(root, "node_modules/convex"), { recursive: true });
  await writeFile(
    join(root, "node_modules/convex/package.json"),
    JSON.stringify({ name: "convex", bin: { convex: "cli.cjs" } }),
  );
  await writeFile(
    join(root, "node_modules/convex/cli.cjs"),
    `
    const fs=require('node:fs'), path=require('node:path'), args=process.argv.slice(2);
    const event=(x)=>fs.appendFileSync('events',x+'\\n');
    if(args[0]==='env') { const file=args[args.indexOf('--from-file')+1]; if(!fs.readFileSync(file,'utf8').includes('EXAMPLE=ready')) process.exit(9); event('import'); }
    else if(!fs.existsSync('.convex/local/default/config.json')) {
      fs.mkdirSync('.convex/local/default',{recursive:true});
      fs.writeFileSync('.convex/local/default/config.json',JSON.stringify({deploymentName:'anonymous-'+path.basename(process.cwd()),ports:{cloud:Number(args[args.indexOf('--local-cloud-port')+1]),site:Number(args[args.indexOf('--local-site-port')+1])}})); event('bootstrap');
    } else event('push');
  `,
  );
  await writeFile(
    join(root, "scripts/example/prepare.mjs"),
    "import fs from 'node:fs'; fs.appendFileSync('events','prepare\\n');",
  );
  await writeFile(
    join(root, "scripts/example/credentials.mjs"),
    "import fs from 'node:fs'; const c=JSON.parse(process.env.WORKTREE_CONTEXT); fs.writeFileSync(c.environmentFile,'EXAMPLE=ready\\n'); fs.appendFileSync('events','credentials\\n');",
  );
  await writeFile(
    join(root, "scripts/worktree.config.json"),
    JSON.stringify({
      profiles: {
        example: {
          hooks: {
            beforeImport: [
              {
                name: "prepare",
                command: [process.execPath, "scripts/example/prepare.mjs"],
              },
              {
                name: "credentials",
                command: [process.execPath, "scripts/example/credentials.mjs"],
              },
            ],
          },
        },
      },
    }),
  );
  const r = await f.run(root, "setup", "--profile", "example");
  assert.equal(r.code, 0, r.output);
  assert.equal(
    await readFile(join(root, "events"), "utf8"),
    "bootstrap\nprepare\ncredentials\nimport\npush\n",
  );
});

test("legacy-compatibility: editor prepareCommand can invoke the compatibility entry without profiles", async (t) => {
  const f = await fixture(t),
    root = await f.root("legacy");
  const wrapper = fileURLToPath(new URL("../worktree.mjs", import.meta.url));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [wrapper, "setup", "--prepare-only"],
      { cwd: root, env: { ...process.env, WORKTREE_REGISTRY_DIR: f.registry } },
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, output }));
  });
  assert.equal(result.code, 0, result.output);
  const before = await readFile(join(root, ".worktree/local.json"), "utf8");
  assert.equal((await f.run(root, "setup", "--prepare-only")).code, 0);
  assert.equal(
    await readFile(join(root, ".worktree/local.json"), "utf8"),
    before,
  );
});
