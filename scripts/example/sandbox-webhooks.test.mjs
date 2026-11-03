import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import Stripe from "stripe";
import { expect, it } from "vitest";
import { withWebhookProbe } from "./sandbox-webhooks.mjs";

it.each([true, false])(
  "verifies actual request signatures and stops owned listeners: valid=%s",
  async (valid) => {
    const targets = [];
    const children = [];
    const secret = "whsec_fixture";
    const spawnProcess = (_cli, args) => {
      const child = new EventEmitter();
      Object.assign(child, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        pid: 123,
        exitCode: null,
      });
      child.kill = () => {
        child.exitCode = 0;
        child.emit("exit", 0);
      };
      children.push(child);
      targets.push(
        args[
          args.indexOf(
            args.includes("--thin-events")
              ? "--forward-thin-to"
              : "--forward-to",
          ) + 1
        ],
      );
      queueMicrotask(() => child.stdout.write(`Ready ${secret}`));
      return child;
    };
    const report = await withWebhookProbe({
      cli: "fixture",
      config: "private",
      spawnProcess,
      waitMs: 200,
      run: async () => {
        const stripe = new Stripe("sk_test_fixture");
        for (const target of targets) {
          const payload = JSON.stringify({
            id: "evt_fixture",
            object: target.endsWith("/thin") ? "v2.core.event" : "event",
            type: "product.created",
            account: "acct_fixture",
          });
          await fetch(target, {
            method: "POST",
            body: payload,
            headers: {
              "stripe-signature": stripe.webhooks.generateTestHeaderString({
                payload,
                secret: valid ? secret : "whsec_wrong",
              }),
            },
          });
        }
        return { results: {} };
      },
    });
    expect(report.webhooks.snapshot.status).toBe(valid ? "pass" : "fail");
    expect(report.webhooks.thin.status).toBe(valid ? "pass" : "fail");
    expect(children.every((child) => child.exitCode === 0)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(secret);
  },
);
