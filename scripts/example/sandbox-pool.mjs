import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { userInfo } from "node:os";
import Stripe from "stripe";

const recovery = () =>
  new Error(
    "Stripe lease recovery required. Keep the existing Convex data and lease files; restore the original pool association before retrying. Do not assign another sandbox to this backend.",
  );
const fingerprint = (key) => createHash("sha256").update(key).digest("hex");
export const defaultPoolFile = () =>
  process.env.STRIPE_SANDBOX_POOL_FILE ||
  path.join(userInfo().homedir, ".config/better-stripe/sandboxes.json");

export async function noLinks(file) {
  let current = path.parse(path.resolve(file)).root;
  for (const part of path.resolve(file).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (stat?.isSymbolicLink())
      throw new Error("Refusing symlink in Stripe state path.");
  }
}

async function privateFile(file, fallback) {
  await noLinks(file);
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error(
        "Stripe state must be an owner-only regular file (chmod 600).",
      );
    return JSON.parse(await handle.readFile("utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function atomic(file, value) {
  await noLinks(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(
      temporary,
      typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function locked(poolFile, action) {
  if (!path.isAbsolute(poolFile))
    throw new Error("Stripe pool path must be absolute.");
  await noLinks(poolFile);
  await fs.mkdir(path.dirname(poolFile), { recursive: true, mode: 0o700 });
  const parent = await fs.stat(path.dirname(poolFile));
  if (
    parent.mode & 0o077 ||
    (process.getuid && parent.uid !== process.getuid())
  )
    throw new Error("Stripe pool directory must be owner-only (chmod 700).");
  const lock = `${poolFile}.lock`;
  const deadline = Date.now() + 45000;
  while (true) {
    try {
      await fs.mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(
          "Stripe pool is locked. Retry, or check that no setup process is active before removing its stale lock directory.",
        );
      await sleep(50);
    }
  }
  try {
    return await action();
  } finally {
    await fs.rmdir(lock);
  }
}

function validateKey(secretKey) {
  if (
    typeof secretKey !== "string" ||
    !/^sk_test_[A-Za-z0-9]{24,}$/.test(secretKey)
  )
    throw new Error(
      "Use a full test secret key (sk_test_) from an account-owned sandbox.",
    );
}

export async function verifyStripeAccount(secretKey) {
  return new Stripe(secretKey, {
    apiVersion: "2026-09-30.endive",
    timeout: 15000,
    maxNetworkRetries: 0,
  }).accounts.retrieve();
}

async function verified(secretKey, verify) {
  validateKey(secretKey);
  let account;
  try {
    account = await verify(secretKey);
  } catch {
    throw new Error(
      "Stripe account verification failed. Check the sandbox key and network connection; no credentials were printed.",
    );
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(account?.id || ""))
    throw new Error("Stripe returned an invalid account identity.");
  return account.id;
}

function validatePool(pool) {
  if (pool.version !== 1 || !Array.isArray(pool.sandboxes))
    throw new Error("Invalid Stripe pool format.");
  const ids = new Set();
  const accounts = new Set();
  for (const slot of pool.sandboxes) {
    validateKey(slot.secretKey);
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slot.id || "") ||
      !/^acct_[A-Za-z0-9]+$/.test(slot.accountId || "") ||
      typeof slot.generation !== "string" ||
      !slot.generation
    )
      throw new Error("Invalid Stripe pool slot metadata.");
    if (ids.has(slot.id) || accounts.has(slot.accountId))
      throw new Error("Stripe slot or account is already registered.");
    ids.add(slot.id);
    accounts.add(slot.accountId);
  }
  return pool;
}

export async function registerSandbox({
  poolFile = defaultPoolFile(),
  id,
  secretKey,
  verify = verifyStripeAccount,
}) {
  validateKey(secretKey);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id || ""))
    throw new Error(
      "Use a sandbox name with lowercase letters, digits and hyphens (up to 64 characters).",
    );
  const accountId = await verified(secretKey, verify);
  return locked(poolFile, async () => {
    const pool = validatePool(
      await privateFile(poolFile, { version: 1, sandboxes: [] }),
    );
    if (
      pool.sandboxes.some(
        (slot) => slot.id === id || slot.accountId === accountId,
      )
    )
      throw new Error(
        "Stripe slot or account is already registered. Existing credentials were not replaced.",
      );
    pool.sandboxes.push({ id, accountId, secretKey, generation: randomUUID() });
    await atomic(poolFile, pool);
    return { id, accountId };
  });
}

async function validateContext(context) {
  if (
    context?.version !== 1 ||
    context.profile !== "example" ||
    !path.isAbsolute(context.root || "") ||
    context.stateDirectory !== path.join(context.root, ".worktree") ||
    context.environmentFile !== path.join(context.stateDirectory, "backend.env")
  )
    throw new Error("This command requires the example worktree context.");
  await noLinks(context.stateDirectory);
  const state = JSON.parse(
    await fs.readFile(path.join(context.stateDirectory, "local.json"), "utf8"),
  );
  if (
    state.id !== context.id ||
    state.root !== context.root ||
    (await fs.realpath(context.root)) !== context.root
  )
    throw recovery();
}

const localPath = (context) =>
  path.join(context.stateDirectory, "stripe-lease.json");
async function registry(poolFile) {
  const data = await privateFile(`${poolFile}.leases.json`, {
    version: 1,
    leases: [],
  });
  if (data.version !== 1 || !Array.isArray(data.leases))
    throw new Error(
      "Invalid Stripe lease registry. Restore it before setup; do not delete it to free slots.",
    );
  return data;
}
function matches(lease, slot, context, poolFile) {
  return (
    lease.status === "leased" &&
    lease.worktreeId === context.id &&
    lease.root === context.root &&
    lease.poolFile === poolFile &&
    lease.slotId === slot.id &&
    lease.accountId === slot.accountId &&
    lease.generation === slot.generation &&
    lease.keyFingerprint === fingerprint(slot.secretKey)
  );
}
async function association(poolFile, context, allocate) {
  const pool = validatePool(await privateFile(poolFile));
  const data = await registry(poolFile);
  const local = await privateFile(localPath(context), null);
  const existing = data.leases.filter(
    (lease) => lease.worktreeId === context.id || lease.root === context.root,
  );
  if (local || existing.length) {
    const lease =
      existing.find((item) => item.token === local?.token) ||
      (!local && existing.length === 1 ? existing[0] : null);
    const slot = pool.sandboxes.find((item) => item.id === lease?.slotId);
    if (
      !slot ||
      !lease ||
      !matches(lease, slot, context, poolFile) ||
      (local && JSON.stringify(local) !== JSON.stringify(lease))
    )
      throw recovery();
    return { slot, lease, data };
  }
  if (!allocate)
    throw new Error(
      "Run pnpm worktree:setup --profile example to prepare a Stripe lease before start.",
    );
  await noLinks(context.environmentFile);
  const environment = await fs
    .readFile(context.environmentFile, "utf8")
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "";
    });
  const keys = Array.from(
    environment.matchAll(
      /^\s*(?:export\s+)?STRIPE_SECRET_KEY\s*=\s*(.*?)\s*$/gm,
    ),
    (match) => match[1],
  );
  const previousKey = keys[0];
  const hasPriorAccount =
    previousKey &&
    previousKey !== "sk_test_worktree_synthetic_not_a_credential";
  if (
    keys.length > 1 ||
    (hasPriorAccount &&
      !pool.sandboxes.some((slot) => slot.secretKey === previousKey))
  )
    throw recovery();
  const slot = pool.sandboxes.find(
    (item) =>
      (!hasPriorAccount || item.secretKey === previousKey) &&
      !data.leases.some(
        (lease) =>
          lease.slotId === item.id || lease.accountId === item.accountId,
      ),
  );
  if (!slot)
    throw new Error(
      "Stripe sandbox pool exhausted: all slots are leased or quarantined. Add another sandbox or complete operator recovery; stopped worktrees retain their leases.",
    );
  const lease = {
    status: "leased",
    token: randomUUID(),
    poolFile,
    worktreeId: context.id,
    root: context.root,
    slotId: slot.id,
    accountId: slot.accountId,
    generation: slot.generation,
    keyFingerprint: fingerprint(slot.secretKey),
  };
  data.leases.push(lease);
  return { slot, lease, data };
}

async function importKey(context, secretKey) {
  await noLinks(context.environmentFile);
  const content = await fs
    .readFile(context.environmentFile, "utf8")
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "";
    });
  const lines = content
    .split("\n")
    .filter((line) => !/^\s*(?:export\s+)?STRIPE_SECRET_KEY\s*=/.test(line))
    .join("\n")
    .trimEnd();
  await atomic(
    context.environmentFile,
    `${lines}${lines ? "\n" : ""}STRIPE_SECRET_KEY=${secretKey}\n`,
  );
}

export async function leaseSandbox({
  poolFile = defaultPoolFile(),
  context,
  verify = verifyStripeAccount,
}) {
  await validateContext(context);
  return locked(poolFile, async () => {
    const { slot, lease, data } = await association(poolFile, context, true);
    if ((await verified(slot.secretKey, verify)) !== slot.accountId)
      throw new Error(
        "Stripe account does not match the registered sandbox. Restore its credentials before retrying.",
      );
    // Reserve globally first. A partial local write can safely retry with this owner.
    await atomic(`${poolFile}.leases.json`, data);
    await atomic(localPath(context), lease);
    await importKey(context, slot.secretKey);
    return lease;
  });
}

export async function readLeaseCredentials({
  poolFile = defaultPoolFile(),
  context,
}) {
  await validateContext(context);
  return locked(poolFile, async () => {
    const { slot, lease } = await association(poolFile, context, false);
    const content = await fs.readFile(context.environmentFile, "utf8");
    if (!content.split("\n").includes(`STRIPE_SECRET_KEY=${slot.secretKey}`))
      throw recovery();
    return { lease, secretKey: slot.secretKey };
  });
}

export async function requireLease(options) {
  return (await readLeaseCredentials(options)).lease;
}

export async function releaseLease({ poolFile = defaultPoolFile(), context }) {
  await validateContext(context);
  return locked(poolFile, async () => {
    const runtime = await fs
      .readFile(path.join(context.stateDirectory, "runtime.json"), "utf8")
      .then(JSON.parse)
      .catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    if (runtime?.pid) {
      try {
        process.kill(runtime.pid, 0);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      // Retained runtime files are removed by a successful runner stop.
      if (
        await fs
          .stat(path.join(context.stateDirectory, "runtime.json"))
          .catch(() => null)
      )
        throw new Error(
          "Stop the worktree with pnpm worktree:stop before releasing its Stripe lease.",
        );
    }
    const { lease, data } = await association(poolFile, context, false);
    lease.status = "quarantined";
    await atomic(`${poolFile}.leases.json`, data);
    await atomic(localPath(context), lease);
    return {
      slotId: lease.slotId,
      accountId: lease.accountId,
      status: lease.status,
    };
  });
}
