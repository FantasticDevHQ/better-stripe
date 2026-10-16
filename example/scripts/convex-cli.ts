import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const exampleDir = resolve(import.meta.dirname, "..");

export function convex(args: string[], timeoutMs = 120_000): string {
  return execFileSync("npx", ["convex", ...args], {
    cwd: exampleDir,
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function convexRun<T>(
  fn: string,
  args: Record<string, unknown> = {},
): T {
  const out = convex(["run", fn, JSON.stringify(args)]).trim();
  return (out ? JSON.parse(out) : null) as T;
}

export function convexEnvSet(name: string, value: string): void {
  convex(["env", "set", name, value]);
}
