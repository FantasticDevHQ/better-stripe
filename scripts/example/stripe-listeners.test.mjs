import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { startListeners } from "./stripe-listeners.mjs";

function fixture() {
  const calls = [];
  const spawnProcess = (cli, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => {
      child.signalCode = signal;
      queueMicrotask(() => child.emit("close", null, signal));
      return true;
    };
    calls.push({ cli, args, options, child });
    return child;
  };
  const listeners = startListeners({
    cli: "stripe",
    config: "/private/cli.toml",
    secretKey: "sk_test_fixture",
    sitePort: 18005,
    spawnProcess,
    environment: {
      STRIPE_API_KEY: "sk_live_inherited",
      STRIPE_ACCOUNT: "acct_wrong",
      HTTPS_PROXY: "proxy",
    },
  });
  return { calls, listeners };
}

it("forwards both event formats and Connect events to only the reserved site port", async () => {
  const { calls, listeners } = fixture();
  try {
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toContain("--all-snapshot");
    for (const call of calls) {
      expect(call.args.filter((item) => item.startsWith("http:"))).toEqual([
        "http://127.0.0.1:18005/stripe/webhook",
        "http://127.0.0.1:18005/stripe/webhook",
      ]);
      expect(call.args.join(" ")).not.toContain("sk_test_fixture");
      expect(call.options.env).toEqual({
        HTTPS_PROXY: "proxy",
        STRIPE_API_KEY: "sk_test_fixture",
      });
    }
    const thinTypes =
      calls[1].args[calls[1].args.indexOf("--thin-events") + 1].split(",");
    expect(thinTypes).toContain("v2.core.account.updated");
    expect(thinTypes).toContain("v1.billing.meter.error_report_triggered");
    expect(thinTypes).not.toContain("*");
    expect(thinTypes).not.toContain("v1.product.updated");
  } finally {
    await listeners.stop();
  }
});

it("waits for complete readiness lines from both listeners", async () => {
  const { calls, listeners } = fixture();
  try {
    let ready = false;
    const result = listeners.ready.then((value) => {
      ready = true;
      return value;
    });
    calls[0].child.stderr.write(
      "> Ready! Your webhook signing secret is whsec_first\n",
    );
    calls[1].child.stderr.write(
      "> Ready! Your webhook signing secret is whsec_se",
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(ready).toBe(false);
    calls[1].child.stderr.write("cond\n");
    expect(await result).toEqual({
      STRIPE_WEBHOOK_SECRET: "whsec_first",
      STRIPE_WEBHOOK_SECRET_V2: "whsec_second",
    });
  } finally {
    await listeners.stop();
  }
});

it("sanitizes listener spawn failures", async () => {
  const { calls, listeners } = fixture();
  const ready = expect(listeners.ready).rejects.toThrow(
    /^Stripe snapshot listener failed\.$/,
  );
  calls[0].child.emit("error", new Error("sk_live_private whsec_private"));
  await ready;
  await listeners.stop();
});

it("reports runtime exits and stops only owned children", async () => {
  const { calls, listeners } = fixture();
  for (const [i, call] of calls.entries())
    call.child.stderr.write(
      `> Ready! Your webhook signing secret is whsec_${i}\n`,
    );
  await listeners.ready;
  const failed = expect(listeners.failure).rejects.toThrow(
    "Stripe thin listener failed",
  );
  calls[1].child.exitCode = 1;
  calls[1].child.emit("close", 1, null);
  await failed;
  await listeners.stop();
  expect(calls[0].child.signalCode).toBe("SIGINT");
});

it("rejects invalid reserved ports before starting a process", () => {
  expect(() => startListeners({ sitePort: "18005;bad" })).toThrow(
    "reserved site port",
  );
});
