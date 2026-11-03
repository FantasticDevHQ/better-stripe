import "./test-safety.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(tmpdir(), "worktree-services-"));
  const roots = [];
  async function run(root, ...args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
          WORKTREE_REGISTRY_DIR: path.join(base, "registry"),
        },
      });
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.once("error", reject);
      child.once("exit", (code) => resolve({ code, output }));
    });
  }
  const read = async (root, file) =>
    JSON.parse(await fs.readFile(path.join(root, ".worktree", file), "utf8"));
  async function root(name, services) {
    const root = path.join(base, name);
    roots.push(root);
    await fs.mkdir(path.join(root, "scripts/example"), { recursive: true });
    await fs.writeFile(
      path.join(root, "scripts/worktree.config.json"),
      JSON.stringify({ convex: false, profiles: { example: { services } } }),
    );
    await fs.writeFile(
      path.join(root, "scripts/example/service.mjs"),
      `import fs from 'node:fs';
      const c=JSON.parse(process.env.WORKTREE_CONTEXT);fs.appendFileSync('.worktree/starts',JSON.stringify({...c,pid:process.pid})+'\\n');
      setTimeout(()=>fs.writeFileSync('.worktree/ready','yes'),200);
      const timer=setInterval(()=>{if(fs.existsSync('.worktree/crash'))process.exit(8)},20);
      process.on('SIGINT',()=>{clearInterval(timer);process.exit(0)});
    `,
    );
    await fs.writeFile(
      path.join(root, "scripts/example/ready.mjs"),
      `import fs from 'node:fs';
      const timer=setInterval(()=>{if(fs.existsSync('.worktree/ready')){clearInterval(timer);process.exit(0)}},20);
    `,
    );
    const r = await run(root, "setup");
    assert.equal(r.code, 0, r.output);
    return root;
  }
  t.after(async () => {
    for (const root of roots) await run(root, "stop");
    await fs.rm(base, { recursive: true, force: true });
  });
  return { root, run, read };
}
const service = () => ({
  command: [process.execPath, "scripts/example/service.mjs"],
  readiness: {
    command: [process.execPath, "scripts/example/ready.mjs"],
    timeoutMs: 3000,
  },
});
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function gone(pid) {
  for (let i = 0; i < 100 && alive(pid); i++) await pause(30);
  assert.equal(alive(pid), false);
}

test("owned-start, service-context, readiness, repeat-start, owned-stop, restart and teardown", async (t) => {
  const f = await fixture(t),
    a = await f.root("a", { example: service() }),
    b = await f.root("b", { example: service() });
  const start = Date.now();
  for (const root of [a, b]) {
    const r = await f.run(root, "start", "--profile", "example");
    assert.equal(r.code, 0, r.output);
  }
  assert.ok(Date.now() - start >= 400);
  const sa = await f.read(a, "services.json"),
    sb = await f.read(b, "services.json");
  assert.equal(sa.services.example.status, "ready");
  assert.notEqual(sa.services.example.pid, sb.services.example.pid);
  const ca = JSON.parse(
    (await fs.readFile(path.join(a, ".worktree/starts"), "utf8")).trim(),
  );
  const cb = JSON.parse(
    (await fs.readFile(path.join(b, ".worktree/starts"), "utf8")).trim(),
  );
  assert.equal(ca.root, a);
  assert.equal(cb.root, b);
  assert.notEqual(ca.id, cb.id);
  assert.equal(ca.profile, "example");
  assert.equal((await f.run(a, "start")).code, 0);
  assert.equal(
    (await f.read(a, "services.json")).services.example.pid,
    sa.services.example.pid,
  );
  assert.equal((await f.run(a, "stop")).code, 0);
  await gone(sa.services.example.pid);
  assert.equal(alive(sb.services.example.pid), true);
  await fs.rm(path.join(a, ".worktree/ready"));
  assert.equal((await f.run(a, "start")).code, 0);
  const restarted = await f.read(a, "services.json");
  assert.notEqual(restarted.services.example.pid, sa.services.example.pid);
  const starts = (await fs.readFile(path.join(a, ".worktree/starts"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(starts.length, 2);
  assert.equal(starts[1].id, ca.id);
  assert.equal((await f.run(a, "teardown")).code, 0);
  await gone(restarted.services.example.pid);
  assert.equal((await f.read(a, "local.json")).serviceProfile, "example");
  assert.equal(alive(sb.services.example.pid), true);
});

test("startup-failure reports service name and cleans partial startup", async (t) => {
  const f = await fixture(t),
    bad = service();
  bad.command = [process.execPath, "-e", "process.exit(7)"];
  const root = await f.root("partial", { first: service(), broken: bad });
  // Simulate a supervisor whose argv disappears during exit. Startup still
  // owns its ChildProcess and must not rediscover it through a PID snapshot.
  await fs.mkdir(path.join(root, "bin"));
  await fs.writeFile(
    path.join(root, "bin/ps"),
    "#!/bin/sh\nprintf 'S unrelated\\n'\n",
    { mode: 0o700 },
  );
  await fs.appendFile(
    path.join(root, "scripts/example/service.mjs"),
    "\nprocess.removeAllListeners('SIGINT');process.on('SIGINT',()=>{});\n",
  );
  const r = await f.run(root, "start", "--profile", "example");
  assert.notEqual(r.code, 0);
  assert.match(r.output, /Service broken.*(7|failed)/);
  const status = await f.read(root, "services.json");
  assert.equal(status.services.broken.status, "failed");
  await gone(status.services.first.pid);
});

test("runtime-exit status reports named failure", async (t) => {
  const f = await fixture(t),
    root = await f.root("crash", { example: service() });
  assert.equal((await f.run(root, "start", "--profile", "example")).code, 0);
  const pid = (await f.read(root, "services.json")).services.example.pid;
  await fs.writeFile(path.join(root, ".worktree/crash"), "crash");
  await gone(pid);
  let status;
  for (let i = 0; i < 100; i++) {
    status = await f.run(root, "status");
    if (status.code !== 0) break;
    await pause(20);
  }
  assert.notEqual(status.code, 0);
  assert.match(status.output, /Service example failed: exit 8/);
});

test("readiness timeout and nonzero readiness fail with names", async (t) => {
  const f = await fixture(t);
  for (const [name, command] of [
    ["timeout", [process.execPath, "-e", "setInterval(()=>{},1000)"]],
    ["nonzero", [process.execPath, "-e", "process.exit(6)"]],
  ]) {
    const s = service();
    s.readiness = { command, timeoutMs: 100 };
    const root = await f.root(name, { [name]: s });
    const r = await f.run(root, "start", "--profile", "example");
    assert.notEqual(r.code, 0);
    assert.match(r.output, new RegExp(`Service ${name} readiness`));
    await gone((await f.read(root, "services.json")).services[name].pid);
  }
});

test("stale runtime readiness cannot satisfy a new supervisor and reserved names remain owned records", async (t) => {
  const f = await fixture(t),
    root = await f.root(
      "stale",
      JSON.parse(
        JSON.stringify({ listener: service() }).replace(
          "listener",
          "__proto__",
        ),
      ),
    );
  const state = await f.read(root, "local.json");
  await fs.writeFile(
    path.join(root, ".worktree/runtime.json"),
    JSON.stringify({ id: state.id, pid: 2147483647, ready: true }),
  );
  const start = Date.now(),
    r = await f.run(root, "start", "--profile", "example");
  assert.equal(r.code, 0, r.output);
  assert.ok(Date.now() - start >= 200);
  const services = (await f.read(root, "services.json")).services;
  assert.ok(Object.hasOwn(services, "__proto__"));
  assert.equal(services.__proto__.status, "ready");
  assert.equal((await f.run(root, "stop")).code, 0);
  await gone(services.__proto__.pid);
});

test("missing service and readiness executables return named failures with cleanup", async (t) => {
  const f = await fixture(t);
  for (const which of ["command", "readiness"]) {
    const s = service();
    if (which === "command")
      s.command = ["/definitely-missing-worktree-service"];
    else s.readiness.command = ["/definitely-missing-worktree-probe"];
    const root = await f.root(which, { missing: s });
    const r = await f.run(root, "start", "--profile", "example");
    assert.notEqual(r.code, 0);
    assert.match(r.output, /Service missing.*(ENOENT|failed)/);
    const record = (await f.read(root, "services.json")).services.missing;
    assert.equal(record.status, "failed");
    if (record.pid) await gone(record.pid);
  }
});

test("service declarations require bounded readiness and literal command arrays", async (t) => {
  const f = await fixture(t),
    root = await f.root("invalid", {});
  for (const bad of [
    { command: [] },
    { command: ["node"], readiness: { command: ["node"], timeoutMs: 0 } },
    {
      command: "node server",
      readiness: { command: ["node"], timeoutMs: 100 },
    },
  ]) {
    await fs.writeFile(
      path.join(root, "scripts/worktree.config.json"),
      JSON.stringify({
        convex: false,
        profiles: { example: { services: { bad } } },
      }),
    );
    const r = await f.run(root, "start", "--profile", "example");
    assert.notEqual(r.code, 0);
    assert.match(r.output, /configuration.*invalid service/);
  }
});

test("managed backend readiness precedes services and frontend with reserved-port context", async (t) => {
  const f = await fixture(t),
    root = await f.root("managed", {});
  assert.equal((await f.run(root, "cleanup", "--yes")).code, 0);
  await fs.writeFile(path.join(root, "convex.json"), "{}");
  await fs.writeFile(
    path.join(root, "scripts/worktree.config.json"),
    JSON.stringify({
      profiles: { example: { services: { listener: service() } } },
    }),
  );
  for (const name of ["convex", "vite"]) {
    await fs.mkdir(path.join(root, "node_modules", name), { recursive: true });
    await fs.writeFile(
      path.join(root, "node_modules", name, "package.json"),
      JSON.stringify({ name, bin: { [name]: "cli.cjs" } }),
    );
  }
  await fs.writeFile(
    path.join(root, "node_modules/convex/cli.cjs"),
    `
    const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
    if(args[0]==='env')process.exit(0);
    if(!fs.existsSync('.convex/local/default/config.json')){
      fs.mkdirSync('.convex/local/default',{recursive:true});
      fs.writeFileSync('.convex/local/default/config.json',JSON.stringify({deploymentName:'anonymous-'+path.basename(process.cwd()),ports:{cloud:Number(args[args.indexOf('--local-cloud-port')+1]),site:Number(args[args.indexOf('--local-site-port')+1])}}));
    }
    if(args.includes('--once'))process.exit(0);
    setTimeout(()=>{fs.writeFileSync('.worktree/backend-ready','yes');console.log('Convex functions ready');},150);
    setInterval(()=>{},1000);
  `,
  );
  await fs.writeFile(
    path.join(root, "node_modules/vite/cli.cjs"),
    `
    const fs=require('node:fs'),args=process.argv.slice(2);if(!fs.existsSync('.worktree/ready'))process.exit(9);
    const state=JSON.parse(fs.readFileSync('.worktree/local.json'));
    if(!args.includes('--strictPort') || args[args.indexOf('--host')+1]!=='127.0.0.1' || Number(args[args.indexOf('--port')+1])!==state.ports.web)process.exit(10);
    fs.writeFileSync('.worktree/frontend-ready','yes');setInterval(()=>{},1000);
  `,
  );
  const script = path.join(root, "scripts/example/service.mjs");
  await fs.writeFile(
    script,
    "import fs0 from 'node:fs'; if(!fs0.existsSync('.worktree/backend-ready'))process.exit(9);\n" +
      (await fs.readFile(script, "utf8")),
  );
  let result = await f.run(root, "setup");
  assert.equal(result.code, 0, result.output);
  result = await f.run(root, "start", "--profile", "example", "--frontend");
  assert.equal(result.code, 0, result.output);
  const context = JSON.parse(
    (await fs.readFile(path.join(root, ".worktree/starts"), "utf8")).trim(),
  );
  const state = await f.read(root, "local.json");
  assert.deepEqual(context.ports, state.ports);
  for (let i = 0; i < 100; i++) {
    try {
      await fs.access(path.join(root, ".worktree/frontend-ready"));
      break;
    } catch {
      await pause(20);
    }
  }
  assert.equal(
    await fs.readFile(path.join(root, ".worktree/frontend-ready"), "utf8"),
    "yes",
  );
  result = await f.run(root, "teardown");
  assert.equal(result.code, 0, result.output);
  await gone(context.pid);
});
