import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  registerSandbox,
  leaseSandbox,
  requireLease,
  releaseLease,
} from "./sandbox-pool.mjs";

const directories = [];
const key = (suffix) => `sk_test_${"a".repeat(24)}${suffix}`;
const verify = async (secret) => ({
  id: secret.endsWith("B") ? "acct_B" : "acct_A",
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "stripe-pool-"));
  directories.push(root);
  await fs.chmod(root, 0o700);
  const poolFile = path.join(root, "private", "sandboxes.json");
  const context = async (id) => {
    const checkout = path.join(root, id);
    const stateDirectory = path.join(checkout, ".worktree");
    await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      path.join(stateDirectory, "local.json"),
      JSON.stringify({ id, root: checkout }),
    );
    return {
      version: 1,
      profile: "example",
      phase: "beforeImport",
      id,
      root: checkout,
      stateDirectory,
      environmentFile: path.join(stateDirectory, "backend.env"),
    };
  };
  await registerSandbox({ poolFile, id: "first", secretKey: key("A"), verify });
  return { root, poolFile, context };
}
afterEach(async () => {
  for (const dir of directories.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});

it("registers a verified sandbox without hand-written JSON in owner-only files", async () => {
  const { poolFile } = await fixture();
  const pool = JSON.parse(await fs.readFile(poolFile, "utf8"));
  expect(pool.sandboxes[0].accountId).toBe("acct_A");
  expect((await fs.stat(poolFile)).mode & 0o777).toBe(0o600);
  expect((await fs.stat(path.dirname(poolFile))).mode & 0o777).toBe(0o700);
});

it.each([
  "sk_live_private",
  "rkcs_test_private",
  "rk_test_private",
  "sk_test_short",
  "sk_test_a\nBAD=1",
])("rejects unsupported key without calling Stripe: %s", async (secretKey) => {
  const { poolFile } = await fixture();
  await expect(
    registerSandbox({
      poolFile,
      id: "bad",
      secretKey,
      verify: () => {
        throw new Error("must not call Stripe");
      },
    }),
  ).rejects.toThrow("full test secret key");
});

it("refuses duplicate accounts under different slot names", async () => {
  const { poolFile } = await fixture();
  await expect(
    registerSandbox({ poolFile, id: "second", secretKey: key("A"), verify }),
  ).rejects.toThrow("already registered");
});

it("does not leak provider errors that contain a credential", async () => {
  const { poolFile } = await fixture();
  await expect(
    registerSandbox({
      poolFile,
      id: "second",
      secretKey: key("B"),
      verify: () => {
        throw new Error(key("B"));
      },
    }),
  ).rejects.toThrow(/^Stripe account verification failed/);
});

it("serializes independent worktree allocation and reports pool exhaustion", async () => {
  const { poolFile, context } = await fixture();
  const contexts = await Promise.all([context("one"), context("two")]);
  const results = await Promise.allSettled(
    contexts.map((context) => leaseSandbox({ poolFile, context, verify })),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    results.find((result) => result.status === "rejected").reason.message,
  ).toContain("exhausted");
});

it("retries concurrent setup for the same worktree with one account", async () => {
  const { poolFile, context } = await fixture();
  const ctx = await context("one");
  const leases = await Promise.all(
    Array.from({ length: 4 }, () =>
      leaseSandbox({ poolFile, context: ctx, verify }),
    ),
  );
  expect(new Set(leases.map((lease) => lease.token)).size).toBe(1);
  expect(await fs.readFile(ctx.environmentFile, "utf8")).toContain(
    `STRIPE_SECRET_KEY=${key("A")}`,
  );
  expect((await fs.stat(ctx.environmentFile)).mode & 0o777).toBe(0o600);
});

it("leases distinct accounts to two worktrees", async () => {
  const { poolFile, context } = await fixture();
  await registerSandbox({
    poolFile,
    id: "second",
    secretKey: key("B"),
    verify,
  });
  const leases = await Promise.all(
    ["one", "two"].map(async (id) =>
      leaseSandbox({ poolFile, context: await context(id), verify }),
    ),
  );
  expect(new Set(leases.map((lease) => lease.accountId)).size).toBe(2);
});

it("blocks changed credentials before import and preserves the saved association", async () => {
  const { poolFile, context } = await fixture();
  const ctx = await context("one");
  await leaseSandbox({ poolFile, context: ctx, verify });
  const pool = JSON.parse(await fs.readFile(poolFile, "utf8"));
  pool.sandboxes[0].secretKey = key("B");
  await fs.writeFile(poolFile, JSON.stringify(pool));
  await expect(
    leaseSandbox({ poolFile, context: ctx, verify }),
  ).rejects.toThrow("recovery");
});

it("quarantines released slots and refuses a stale local association", async () => {
  const { poolFile, context } = await fixture();
  const ctx = await context("one");
  await leaseSandbox({ poolFile, context: ctx, verify });
  await releaseLease({ poolFile, context: ctx });
  await expect(requireLease({ poolFile, context: ctx })).rejects.toThrow(
    "recovery",
  );
  await expect(
    leaseSandbox({ poolFile, context: await context("two"), verify }),
  ).rejects.toThrow("exhausted");
});

it("refuses release while a supervisor may still own the backend", async () => {
  const { poolFile, context } = await fixture();
  const ctx = await context("one");
  await leaseSandbox({ poolFile, context: ctx, verify });
  await fs.writeFile(
    path.join(ctx.stateDirectory, "runtime.json"),
    JSON.stringify({ pid: process.pid, id: ctx.id }),
  );
  await expect(releaseLease({ poolFile, context: ctx })).rejects.toThrow(
    "Stop the worktree",
  );
});

it("refuses symlinked pool paths", async () => {
  const { poolFile, root } = await fixture();
  const link = path.join(root, "linked");
  await fs.symlink(path.dirname(poolFile), link);
  await expect(
    registerSandbox({
      poolFile: path.join(link, "sandboxes.json"),
      id: "second",
      secretKey: key("B"),
      verify,
    }),
  ).rejects.toThrow("symlink");
});

it("does not allocate from an account-mismatched key", async () => {
  const { poolFile, context } = await fixture();
  const ctx = await context("one");
  await expect(
    leaseSandbox({
      poolFile,
      context: ctx,
      verify: async () => ({ id: "acct_other" }),
    }),
  ).rejects.toThrow("account does not match");
  await expect(fs.readFile(ctx.environmentFile)).rejects.toThrow();
});

it("does not replace a manually configured backend account on first adoption", async () => {
  const { poolFile, context } = await fixture();
  const ctx = await context("one");
  await fs.writeFile(ctx.environmentFile, `STRIPE_SECRET_KEY=${key("B")}\n`);
  await expect(
    leaseSandbox({ poolFile, context: ctx, verify }),
  ).rejects.toThrow("recovery");
  expect(await fs.readFile(ctx.environmentFile, "utf8")).toContain(key("B"));
});

it("adopts a manually configured backend only from the identical registered key", async () => {
  const { poolFile, context } = await fixture();
  await registerSandbox({
    poolFile,
    id: "second",
    secretKey: key("B"),
    verify,
  });
  const ctx = await context("one");
  await fs.writeFile(ctx.environmentFile, `STRIPE_SECRET_KEY=${key("B")}\n`);
  const lease = await leaseSandbox({ poolFile, context: ctx, verify });
  expect(lease.accountId).toBe("acct_B");
});
