import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { packageBin } from "../worktree/dependencies.mjs";
import { atomic, noLinks, readLeaseCredentials } from "./sandbox-pool.mjs";
import { startListeners } from "./stripe-listeners.mjs";

const execute = promisify(execFile);
export async function serveStripe(context) {
  const { lease, secretKey } = await readLeaseCredentials({ context });
  const layout = JSON.parse(
    await fs.readFile(
      path.join(context.root, "scripts/worktree.config.json"),
      "utf8",
    ),
  );
  if (
    context.phase !== "service" ||
    context.backend !== path.join(context.root, layout.backend || ".")
  )
    throw new Error("Invalid Stripe service context.");
  const directory = path.join(context.stateDirectory, "stripe-listener");
  await noLinks(directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const marker = path.join(directory, "ready.json");
  await noLinks(marker);
  await fs.rm(marker, { force: true });
  const config = path.join(directory, "cli.toml");
  // An explicit empty CLI config and key env prevent use of a developer login.
  await atomic(config, "");
  const cancellation = new AbortController();
  let stopping = false;
  let stopped;
  const shutdown = new Promise((resolve) => {
    stopped = resolve;
  });
  const interrupt = () => {
    stopping = true;
    cancellation.abort();
    void listeners?.stop();
    stopped();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const deadline = setTimeout(() => cancellation.abort(), 60000);
  let listeners;
  let startup;
  try {
    listeners = startListeners({
      cli: process.env.STRIPE_CLI || "stripe",
      config,
      secretKey,
      sitePort: context.ports.site,
    });
    const interrupted = new Promise((_, reject) => {
      if (cancellation.signal.aborted)
        reject(new Error("Stripe startup interrupted."));
      else
        cancellation.signal.addEventListener(
          "abort",
          () => reject(new Error("Stripe startup interrupted.")),
          { once: true },
        );
    });
    void interrupted.catch(() => {});
    startup = (async () => {
      const secrets = await listeners.ready;
      const environment = await fs.readFile(context.environmentFile, "utf8");
      const remaining = environment
        .split("\n")
        .filter(
          (line) =>
            !/^\s*(?:export\s+)?STRIPE_WEBHOOK_SECRET(?:_V2)?\s*=/.test(line),
        )
        .join("\n")
        .trimEnd();
      const values =
        Object.entries(secrets)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n") + "\n";
      await atomic(
        context.environmentFile,
        `${remaining}${remaining ? "\n" : ""}${values}`,
      );
      const secretFile = path.join(directory, "webhooks.env");
      await atomic(secretFile, values);
      const convexEnv = path.join(context.stateDirectory, "convex.env");
      await noLinks(convexEnv);
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) =>
            !key.startsWith("STRIPE_") &&
            !key.startsWith("CONVEX_") &&
            !key.startsWith("VITE_CONVEX_") &&
            !key.startsWith("NEXT_PUBLIC_CONVEX_"),
        ),
      );
      await execute(
        process.execPath,
        [
          packageBin("convex", "convex", [context.backend, context.root]),
          "env",
          "set",
          "--env-file",
          convexEnv,
          "--from-file",
          secretFile,
        ],
        {
          cwd: context.backend,
          env,
          signal: cancellation.signal,
          timeout: 30000,
          killSignal: "SIGKILL",
          maxBuffer: 65536,
        },
      );
      // Recheck the association after import, before publishing readiness.
      await readLeaseCredentials({ context });
      if (cancellation.signal.aborted)
        throw new Error("Stripe startup interrupted.");
      await atomic(marker, {
        id: context.id,
        token: lease.token,
        accountId: lease.accountId,
        pid: process.pid,
        supervisorPid: process.ppid,
      });
    })();
    await Promise.race([startup, listeners.failure, interrupted]);
    clearTimeout(deadline);
    console.log("Stripe webhook listeners ready for the leased sandbox.");
    await Promise.race([listeners.failure, shutdown]);
  } catch {
    if (!stopping)
      throw new Error(
        "Stripe webhook service failed. Check the sandbox lease, Stripe CLI installation and local backend. Raw listener output is private.",
      );
  } finally {
    clearTimeout(deadline);
    cancellation.abort();
    await listeners?.stop();
    await startup?.catch(() => {});
    await fs.rm(marker, { force: true });
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await serveStripe(JSON.parse(process.env.WORKTREE_CONTEXT || "null"));
  } catch {
    console.error(
      "Stripe webhook service failed. Run example setup first, and check the sandbox lease, Stripe CLI and local backend.",
    );
    process.exitCode = 1;
  }
}
