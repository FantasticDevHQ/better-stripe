import { spawn } from "node:child_process";
import path from "node:path";
import { root, backend, frontend, dir, layout } from "./context.mjs";
import { childEnv } from "./config.mjs";

const phases = ["afterPrepare", "beforeImport", "afterPush", "beforeStart"];
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
export function validateProfiles(
  config = layout,
  argv = process.argv.slice(3),
) {
  const fail = (message) => {
    throw new Error(`Profile configuration: ${message}`);
  };
  const profiles = config.profiles ?? {};
  if (!object(profiles)) fail("profiles must be an object");
  for (const [name, profile] of Object.entries(profiles)) {
    if (
      !object(profile) ||
      Object.keys(profile).some((key) => !["hooks", "services"].includes(key))
    )
      fail(`invalid profile ${name}`);
    const services = profile.services ?? {};
    if (!object(services)) fail(`invalid services in ${name}`);
    const command = (args) =>
      Array.isArray(args) &&
      args.length &&
      args.every((a) => typeof a === "string" && !a.includes("\0")) &&
      args[0].trim();
    for (const [service, value] of Object.entries(services)) {
      if (
        !service.trim() ||
        !object(value) ||
        Object.keys(value).some(
          (key) => !["command", "readiness"].includes(key),
        ) ||
        !command(value.command) ||
        !object(value.readiness) ||
        Object.keys(value.readiness).some(
          (key) => !["command", "timeoutMs"].includes(key),
        ) ||
        !command(value.readiness.command) ||
        !Number.isSafeInteger(value.readiness.timeoutMs) ||
        value.readiness.timeoutMs < 1 ||
        value.readiness.timeoutMs > 120000
      )
        fail(`invalid service ${name}/${service}`);
    }
    const hooks = profile.hooks ?? {};
    if (
      !object(hooks) ||
      Object.keys(hooks).some((key) => !phases.includes(key))
    )
      fail(`invalid phases in ${name}`);
    for (const [phase, commands] of Object.entries(hooks)) {
      if (!Array.isArray(commands)) fail(`${name}.${phase} must be an array`);
      for (const hook of commands) {
        if (
          !object(hook) ||
          Object.keys(hook).some(
            (key) => !["name", "command", "timeoutMs"].includes(key),
          ) ||
          typeof hook.name !== "string" ||
          !hook.name.trim() ||
          !Array.isArray(hook.command) ||
          !hook.command.length ||
          hook.command.some(
            (arg) => typeof arg !== "string" || arg.includes("\0"),
          ) ||
          !hook.command[0].trim() ||
          (hook.timeoutMs !== undefined &&
            (!Number.isSafeInteger(hook.timeoutMs) ||
              hook.timeoutMs < 1 ||
              hook.timeoutMs > 3600000))
        )
          fail(`invalid hook in ${name}.${phase}`);
      }
    }
  }
  const indices = argv.flatMap((arg, i) => (arg === "--profile" ? [i] : []));
  if (indices.length > 1 || argv.some((arg) => arg.startsWith("--profile=")))
    fail("use --profile <name> once");
  if (!indices.length) return null;
  const name = argv[indices[0] + 1];
  if (!name || !Object.hasOwn(profiles, name))
    fail(`unknown profile ${name ?? ""}`);
  return {
    name,
    hooks: profiles[name].hooks ?? {},
    services: profiles[name].services ?? {},
  };
}

export function extensionEnv(profile, phase, s) {
  const context = {
    version: 1,
    profile: profile.name,
    phase,
    id: s.id,
    root,
    backend,
    frontend,
    stateDirectory: dir,
    environmentFile: path.join(dir, "backend.env"),
    ports: s.ports ?? {},
  };
  return {
    ...(s.ports ? childEnv(s) : process.env),
    WORKTREE_CONTEXT: JSON.stringify(context),
  };
}

export async function runHooks(profile, phase, s) {
  for (const hook of profile?.hooks[phase] ?? []) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(hook.command[0], hook.command.slice(1), {
          cwd: root,
          shell: false,
          env: extensionEnv(profile, phase, s),
          stdio: "inherit",
        });
        let reason;
        let escalation;
        const interrupt = (message) => {
          reason = message;
          child.kill("SIGTERM");
          escalation ??= setTimeout(() => child.kill("SIGKILL"), 2000);
        };
        const sigint = () => interrupt("interrupted by SIGINT");
        const sigterm = () => interrupt("interrupted by SIGTERM");
        process.on("SIGINT", sigint);
        process.on("SIGTERM", sigterm);
        const timer = setTimeout(
          () => interrupt("timed out"),
          hook.timeoutMs ?? 180000,
        );
        const cleanup = () => {
          clearTimeout(timer);
          clearTimeout(escalation);
          process.off("SIGINT", sigint);
          process.off("SIGTERM", sigterm);
        };
        child.once("error", (error) => {
          cleanup();
          reject(error);
        });
        child.once("exit", (code, signal) => {
          cleanup();
          if (code === 0 && !reason) resolve();
          else reject(new Error(reason ?? `exit ${code ?? signal}`));
        });
      });
    } catch (error) {
      throw new Error(
        `Profile ${profile.name} hook ${phase}/${hook.name} failed: ${error.message}`,
      );
    }
  }
}
