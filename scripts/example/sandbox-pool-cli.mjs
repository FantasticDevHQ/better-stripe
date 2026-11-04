#!/usr/bin/env node
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import {
  defaultPoolFile,
  registerSandbox,
  leaseSandbox,
  requireLease,
  releaseLease,
} from "./sandbox-pool.mjs";

const [command, ...args] = process.argv.slice(2);
const option = (flag) => {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith("--"))
    throw new Error(`Missing value for ${flag}.`);
  return args[index + 1];
};
async function secretInput(file) {
  if (file) {
    const handle = await fs.open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.mode & 0o077 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw new Error(
          "The key file must be an owner-only regular file (chmod 600).",
        );
      return (await handle.readFile("utf8")).trim();
    } finally {
      await handle.close();
    }
  }
  if (!process.stdin.isTTY)
    throw new Error(
      "Use an interactive terminal for the hidden prompt, or pass --key-file <private-file> from secure secret delivery. Do not put the key in an argument.",
    );
  // readline still handles editing, while its output (including typed text) is discarded.
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const prompt = readline.createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  process.stderr.write("Sandbox test secret key (hidden): ");
  try {
    return (await prompt.question("")).trim();
  } finally {
    prompt.close();
    process.stderr.write("\n");
  }
}
async function context() {
  if (process.env.WORKTREE_CONTEXT)
    return JSON.parse(process.env.WORKTREE_CONTEXT);
  const root = await fs.realpath(process.cwd());
  const stateDirectory = path.join(root, ".worktree");
  const state = JSON.parse(
    await fs.readFile(path.join(stateDirectory, "local.json"), "utf8"),
  );
  return {
    version: 1,
    profile: "example",
    root,
    id: state.id,
    stateDirectory,
    environmentFile: path.join(stateDirectory, "backend.env"),
  };
}
try {
  const poolFile = option("--pool") || defaultPoolFile();
  if (command === "--help" || !command) {
    console.log(
      "Stripe sandbox pool\n  register --name <sandbox-name> [--key-file <private-file>] [--pool <absolute-path>]\n  prepare | verify | release [--pool <absolute-path>]\nRegistration uses a hidden prompt by default. It verifies the account ID and writes the private JSON file for you.\nRelease quarantines the slot; it does not reset or delete Stripe data.",
    );
  } else if (command === "register") {
    const result = await registerSandbox({
      poolFile,
      id: option("--name"),
      secretKey: await secretInput(option("--key-file")),
    });
    console.log(
      `Registered sandbox ${result.id} (${result.accountId}). Private pool: ${poolFile}`,
    );
  } else if (["prepare", "verify", "release"].includes(command)) {
    const ctx = await context();
    const run = () =>
      ({ prepare: leaseSandbox, verify: requireLease, release: releaseLease })[
        command
      ]({ poolFile, context: ctx });
    let result;
    if (command === "release") {
      // Same checkout lock as start/setup prevents release racing an in-progress start.
      const { projectLock } = await import("../worktree/registry.mjs");
      result = await projectLock(run, ctx.root);
    } else {
      if (!process.env.WORKTREE_CONTEXT)
        throw new Error(
          "Use pnpm worktree:setup --profile example or pnpm worktree:start --profile example.",
        );
      result = await run();
    }
    console.log(
      `Stripe sandbox ${result.slotId}: ${result.status} (${result.accountId}).`,
    );
  } else throw new Error("Unknown sandbox command. Run with --help.");
} catch (error) {
  // Never include raw SDK/process errors or user-controlled file paths in diagnostics.
  const message = error.message;
  const allowed =
    /^(Use |This command |Run pnpm |Stripe |Stop the worktree|Refusing symlink|Invalid Stripe|The key file|Unknown sandbox|Missing value)/;
  console.error(
    allowed.test(message) &&
      !/\b(?:sk|rk|rkcs)_(?:live|test)_[A-Za-z0-9]+/.test(message)
      ? message
      : "Stripe sandbox command failed. Check private file permissions, setup state and network access. No credentials were printed.",
  );
  process.exitCode = 1;
}
