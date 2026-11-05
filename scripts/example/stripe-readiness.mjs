import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { noLinks, requireLease } from "./sandbox-pool.mjs";

async function read(file) {
  await noLinks(file);
  return fs
    .readFile(file, "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export async function waitForStripe(
  context,
  { timeoutMs = 80000, poolFile } = {},
) {
  const lease = await requireLease({ context, poolFile });
  const deadline = Date.now() + timeoutMs;
  do {
    const [marker, runtime, services] = await Promise.all([
      read(path.join(context.stateDirectory, "stripe-listener", "ready.json")),
      read(path.join(context.stateDirectory, "runtime.json")),
      read(path.join(context.stateDirectory, "services.json")),
    ]);
    if (
      marker?.id === context.id &&
      marker.token === lease.token &&
      marker.accountId === lease.accountId &&
      runtime?.id === context.id &&
      runtime.pid === marker.supervisorPid &&
      services?.id === context.id &&
      services.services?.stripe?.pid === marker.pid &&
      alive(marker.pid) &&
      alive(marker.supervisorPid)
    )
      return;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error("Stripe webhook readiness did not match the owned service.");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await waitForStripe(JSON.parse(process.env.WORKTREE_CONTEXT || "null"));
  } catch {
    console.error(
      "Stripe webhook readiness failed. Check the named service status and sandbox lease.",
    );
    process.exitCode = 1;
  }
}
