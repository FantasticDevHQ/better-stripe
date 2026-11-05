import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import { registerSandbox, leaseSandbox } from "./sandbox-pool.mjs";
import { waitForStripe } from "./stripe-readiness.mjs";

const service = fileURLToPath(new URL("./stripe-service.mjs", import.meta.url));
const dirs = [],
  children = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill("SIGINT");
      await closed;
    }
  }
  for (const dir of dirs.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});
async function fixture(id) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "stripe-service-"));
  dirs.push(root);
  await fs.chmod(root, 0o700);
  const stateDirectory = path.join(root, ".worktree"),
    backend = path.join(root, "example");
  await fs.mkdir(stateDirectory, { mode: 0o700 });
  await fs.mkdir(path.join(root, "scripts"));
  await fs.writeFile(
    path.join(root, "scripts/worktree.config.json"),
    JSON.stringify({ backend: "example" }),
  );
  await fs.mkdir(path.join(backend, "node_modules/convex"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(backend, "node_modules/convex/package.json"),
    JSON.stringify({ name: "convex", bin: { convex: "cli.cjs" } }),
  );
  await fs.writeFile(
    path.join(backend, "node_modules/convex/cli.cjs"),
    `const fs=require('node:fs');const p=require('node:path');const ctx=JSON.parse(process.env.WORKTREE_CONTEXT);const args=process.argv.slice(2);if(args[0]!=='env'||args[1]!=='set'||!args.includes('--env-file'))process.exit(2);const content=fs.readFileSync(args[args.indexOf('--from-file')+1],'utf8');fs.writeFileSync(p.join(ctx.stateDirectory,'imported.env'),content);`,
  );
  const cli = path.join(root, "stripe");
  await fs.writeFile(
    cli,
    `#!/usr/bin/env node
const fs=require('node:fs'),p=require('node:path');const ctx=JSON.parse(process.env.WORKTREE_CONTEXT);const thin=process.argv.includes('--thin-events');const name=thin?'thin':'snapshot';fs.writeFileSync(p.join(ctx.stateDirectory,name+'.pid'),String(process.pid));if(process.env.LISTENER_FIXTURE_FAIL==='yes') {console.error('sk_test_do_not_print whsec_do_not_print');process.exit(2);}if(process.env.LISTENER_FIXTURE_HOLD!=='yes')setTimeout(()=>console.error('> Ready! Your webhook signing secret is whsec_'+process.env.STRIPE_API_KEY.slice(-1)+name),30);setInterval(()=>{},1000);process.on('SIGINT',()=>{fs.writeFileSync(p.join(ctx.stateDirectory,name+'.stopped'),'yes');process.exit(0);});`,
    { mode: 0o700 },
  );
  const context = {
    version: 1,
    profile: "example",
    phase: "service",
    id,
    root,
    backend,
    stateDirectory,
    environmentFile: path.join(stateDirectory, "backend.env"),
    ports: { site: 18005, cloud: 18004, web: 18003 },
  };
  await fs.writeFile(
    path.join(stateDirectory, "local.json"),
    JSON.stringify({ id, root }),
  );
  await fs.writeFile(
    path.join(stateDirectory, "runtime.json"),
    JSON.stringify({ id, pid: process.pid }),
  );
  await fs.writeFile(
    path.join(stateDirectory, "convex.env"),
    "CONVEX_DEPLOYMENT=anonymous:fixture\n",
    { mode: 0o600 },
  );
  const poolFile = path.join(root, "pool", "sandboxes.json"),
    secretKey = `sk_test_${"a".repeat(24)}${id}`;
  const verify = async () => ({ id: `acct_${id}` });
  await registerSandbox({ poolFile, id: id.toLowerCase(), secretKey, verify });
  await leaseSandbox({ poolFile, context, verify });
  return { context, poolFile, cli };
}
async function start(f, extra = {}) {
  const child = spawn(process.execPath, [service], {
    cwd: f.context.root,
    env: {
      ...process.env,
      ...extra,
      STRIPE_CLI: f.cli,
      STRIPE_SANDBOX_POOL_FILE: f.poolFile,
      WORKTREE_CONTEXT: JSON.stringify(f.context),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  await fs.writeFile(
    path.join(f.context.stateDirectory, "services.json"),
    JSON.stringify({
      id: f.context.id,
      services: { stripe: { pid: child.pid } },
    }),
  );
  return { child, output: () => output };
}

it("imports matching secrets before readiness and stops its owned listeners", async () => {
  const f = await fixture("A"),
    run = await start(f);
  await waitForStripe(f.context, { timeoutMs: 5000, poolFile: f.poolFile });
  const imported = await fs.readFile(
    path.join(f.context.stateDirectory, "imported.env"),
    "utf8",
  );
  expect(imported).toContain("STRIPE_WEBHOOK_SECRET=whsec_Asnapshot");
  expect(imported).toContain("STRIPE_WEBHOOK_SECRET_V2=whsec_Athin");
  expect(imported).not.toContain("STRIPE_SECRET_KEY");
  expect((await fs.stat(f.context.environmentFile)).mode & 0o777).toBe(0o600);
  expect(run.output()).not.toMatch(/whsec_|sk_test_/);
  const closed = once(run.child, "close");
  run.child.kill("SIGINT");
  await closed;
  for (const name of ["thin", "snapshot"])
    expect(
      await fs.readFile(
        path.join(f.context.stateDirectory, name + ".stopped"),
        "utf8",
      ),
    ).toBe("yes");
  await expect(
    fs.stat(
      path.join(f.context.stateDirectory, "stripe-listener", "ready.json"),
    ),
  ).rejects.toThrow();
});

it("keeps two worktrees' secrets and stop/restart ownership separate", async () => {
  const a = await fixture("A"),
    b = await fixture("B"),
    first = await start(a),
    second = await start(b);
  await Promise.all(
    [a, b].map((f) =>
      waitForStripe(f.context, { timeoutMs: 5000, poolFile: f.poolFile }),
    ),
  );
  const closed = once(first.child, "close");
  first.child.kill("SIGINT");
  await closed;
  const restarted = await start(a);
  await waitForStripe(a.context, { timeoutMs: 5000, poolFile: a.poolFile });
  expect(restarted.child.pid).not.toBe(first.child.pid);
  expect(second.child.exitCode).toBe(null);
  expect(
    await fs.readFile(
      path.join(b.context.stateDirectory, "imported.env"),
      "utf8",
    ),
  ).toContain("whsec_Bthin");
});

it("fails with a sanitized message and never publishes readiness on listener exit", async () => {
  const f = await fixture("A"),
    run = await start(f, { LISTENER_FIXTURE_FAIL: "yes" });
  const [code] = await once(run.child, "close");
  expect(code).toBe(1);
  expect(run.output()).toContain("Stripe webhook service failed");
  expect(run.output()).not.toMatch(/sk_test_|whsec_/);
  await expect(
    fs.stat(
      path.join(f.context.stateDirectory, "stripe-listener", "ready.json"),
    ),
  ).rejects.toThrow();
});

it("rejects stale readiness from a different service process", async () => {
  const f = await fixture("A"),
    run = await start(f);
  await waitForStripe(f.context, { timeoutMs: 5000, poolFile: f.poolFile });
  await fs.writeFile(
    path.join(f.context.stateDirectory, "services.json"),
    JSON.stringify({
      id: "A",
      services: { stripe: { pid: run.child.pid + 1 } },
    }),
  );
  await expect(
    waitForStripe(f.context, { timeoutMs: 100, poolFile: f.poolFile }),
  ).rejects.toThrow("readiness");
});

it("refuses released leases even when start omitted its beforeStart hook", async () => {
  const f = await fixture("A");
  const file = `${f.poolFile}.leases.json`,
    registry = JSON.parse(await fs.readFile(file, "utf8"));
  registry.leases[0].status = "quarantined";
  await fs.writeFile(file, JSON.stringify(registry));
  const run = await start(f);
  const [code] = await once(run.child, "close");
  expect(code).toBe(1);
  await expect(
    fs.stat(path.join(f.context.stateDirectory, "snapshot.pid")),
  ).rejects.toThrow();
});

it("removes readiness and stops its sibling after a runtime listener failure", async () => {
  const f = await fixture("A"),
    run = await start(f);
  await waitForStripe(f.context, { timeoutMs: 5000, poolFile: f.poolFile });
  const pid = Number(
    await fs.readFile(path.join(f.context.stateDirectory, "thin.pid"), "utf8"),
  );
  const closed = once(run.child, "close");
  // This PID is a child created by this test's owned service, recorded by the fixture.
  process.kill(pid, "SIGTERM");
  const [code] = await closed;
  expect(code).toBe(1);
  expect(
    await fs.readFile(
      path.join(f.context.stateDirectory, "snapshot.stopped"),
      "utf8",
    ),
  ).toBe("yes");
  await expect(
    fs.stat(
      path.join(f.context.stateDirectory, "stripe-listener", "ready.json"),
    ),
  ).rejects.toThrow();
});

it("stops both listeners when the local Convex environment import fails", async () => {
  const f = await fixture("A");
  await fs.writeFile(
    path.join(f.context.backend, "node_modules/convex/cli.cjs"),
    "console.error('whsec_private sk_test_private');process.exit(1);",
  );
  const run = await start(f),
    [code] = await once(run.child, "close");
  expect(code).toBe(1);
  for (const name of ["thin", "snapshot"])
    expect(
      await fs.readFile(
        path.join(f.context.stateDirectory, name + ".stopped"),
        "utf8",
      ),
    ).toBe("yes");
  expect(run.output()).not.toMatch(/whsec_|sk_test_/);
  await expect(
    fs.stat(
      path.join(f.context.stateDirectory, "stripe-listener", "ready.json"),
    ),
  ).rejects.toThrow();
});

it("stops both listeners when interrupted before they report readiness", async () => {
  const f = await fixture("A"),
    run = await start(f, { LISTENER_FIXTURE_HOLD: "yes" });
  const deadline = Date.now() + 3000;
  while (true) {
    const started = await Promise.all(
      ["thin", "snapshot"].map((name) =>
        fs
          .stat(path.join(f.context.stateDirectory, name + ".pid"))
          .catch(() => null),
      ),
    );
    if (started.every(Boolean)) break;
    if (Date.now() > deadline)
      throw new Error("Fixture listeners did not start.");
    await delay(10);
  }
  const closed = once(run.child, "close");
  run.child.kill("SIGINT");
  const [code] = await closed;
  expect(code).toBe(0);
  for (const name of ["thin", "snapshot"])
    expect(
      await fs.readFile(
        path.join(f.context.stateDirectory, name + ".stopped"),
        "utf8",
      ),
    ).toBe("yes");
  await expect(
    fs.stat(path.join(f.context.stateDirectory, "imported.env")),
  ).rejects.toThrow();
});

it("cancels a pending Convex import and its listeners on interruption", async () => {
  const f = await fixture("A");
  await fs.writeFile(
    path.join(f.context.backend, "node_modules/convex/cli.cjs"),
    `const fs=require('node:fs'),p=require('node:path');const ctx=JSON.parse(process.env.WORKTREE_CONTEXT);fs.writeFileSync(p.join(ctx.stateDirectory,'import.pid'),String(process.pid));setInterval(()=>{},1000);`,
  );
  const run = await start(f);
  const file = path.join(f.context.stateDirectory, "import.pid"),
    deadline = Date.now() + 3000;
  let pid;
  while (!pid) {
    pid = await fs
      .readFile(file, "utf8")
      .then(Number)
      .catch(() => null);
    if (!pid && Date.now() > deadline)
      throw new Error("Fixture import did not start.");
    if (!pid) await delay(10);
  }
  const closed = once(run.child, "close");
  run.child.kill("SIGINT");
  const [code] = await closed;
  expect(code).toBe(0);
  expect(() => process.kill(pid, 0)).toThrow();
  for (const name of ["thin", "snapshot"])
    expect(
      await fs.readFile(
        path.join(f.context.stateDirectory, name + ".stopped"),
        "utf8",
      ),
    ).toBe("yes");
  await expect(
    fs.stat(
      path.join(f.context.stateDirectory, "stripe-listener", "ready.json"),
    ),
  ).rejects.toThrow();
});
