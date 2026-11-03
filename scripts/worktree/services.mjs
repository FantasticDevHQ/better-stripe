import { spawn } from "node:child_process";
import path from "node:path";
import { root, dir, read } from "./context.mjs";
import { safe, json } from "./files.mjs";
import { extensionEnv } from "./hooks.mjs";

export const serviceStateFile = path.join(dir, "services.json");
export async function serviceStatus(s) {
  await safe(serviceStateFile);
  const status = await read(serviceStateFile, null);
  if (status && status.id !== s.id)
    throw new Error("Foreign service state; refusing to use it.");
  return status;
}

// Signal only child objects created by this supervisor, never discovered PIDs.
export async function stopChildren(children) {
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise((resolve) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGINT");
      });
    }),
  );
}

export async function launchServices(profile, s, children, fail, isStopping) {
  const records = Object.create(null);
  let writes = Promise.resolve();
  const save = () => {
    const snapshot = {
      id: s.id,
      profile: profile?.name ?? null,
      services: structuredClone(records),
    };
    writes = writes.then(() => json(serviceStateFile, snapshot));
    return writes;
  };
  await serviceStatus(s);
  await save();
  for (const [name, service] of Object.entries(profile?.services ?? {})) {
    if (isStopping()) throw new Error("Service startup interrupted");
    const env = extensionEnv(profile, "service", s);
    const child = spawn(service.command[0], service.command.slice(1), {
      cwd: root,
      env,
      shell: false,
      stdio: ["ignore", "inherit", "inherit"],
    });
    children.push(child);
    records[name] = { pid: child.pid, status: "starting" };
    let exited = false;
    let startupReject;
    const died = new Promise((_, reject) => {
      startupReject = reject;
    });
    const failure = (reason) => {
      exited = true;
      if (isStopping()) return;
      records[name].status = "failed";
      records[name].error = `Service ${name} failed: ${reason}`;
      void save()
        .then(() => fail(records[name].error))
        .catch((error) => fail(error.message));
      startupReject(new Error(records[name].error));
    };
    child.once("error", (error) => failure(error.message));
    child.once("exit", (code, signal) => failure(`exit ${code ?? signal}`));
    // Attach a handler immediately, including while state is written.
    void died.catch(() => {});
    await save();
    let probe;
    try {
      if (exited || isStopping())
        throw new Error(`Service ${name} exited during startup`);
      const ready = new Promise((resolve, reject) => {
        probe = spawn(
          service.readiness.command[0],
          service.readiness.command.slice(1),
          {
            cwd: root,
            env,
            shell: false,
            stdio: ["ignore", "inherit", "inherit"],
          },
        );
        children.push(probe);
        const timer = setTimeout(() => {
          probe.kill("SIGKILL");
          reject(new Error(`Service ${name} readiness timed out`));
        }, service.readiness.timeoutMs);
        probe.once("error", (error) => {
          clearTimeout(timer);
          reject(
            new Error(`Service ${name} readiness failed: ${error.message}`),
          );
        });
        probe.once("exit", (code, signal) => {
          clearTimeout(timer);
          code === 0
            ? resolve()
            : reject(
                new Error(
                  `Service ${name} readiness failed: exit ${code ?? signal}`,
                ),
              );
        });
      });
      await Promise.race([ready, died]);
      if (exited || isStopping())
        throw new Error(`Service ${name} exited during startup`);
      records[name].status = "ready";
      await save();
    } catch (error) {
      if (probe && probe.exitCode === null) probe.kill("SIGKILL");
      records[name].status = "failed";
      records[name].error = error.message;
      await save();
      throw error;
    }
  }
  return async () => {
    for (const record of Object.values(records))
      if (record.status !== "failed") record.status = "stopped";
    await save();
  };
}

export async function markServicesStopped(s) {
  const status = await serviceStatus(s);
  if (!status) return;
  for (const record of Object.values(status.services))
    if (record.status !== "failed") record.status = "stopped";
  await json(serviceStateFile, status);
}
