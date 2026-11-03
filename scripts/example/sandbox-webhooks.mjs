import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import Stripe from "stripe";

export async function withWebhookProbe({
  cli,
  config,
  run,
  waitMs = 15000,
  spawnProcess = spawn,
}) {
  const results = {};
  const secrets = {};
  const children = [];
  const stripe = new Stripe("sk_test_signature_verification_only");
  const server = createServer(async (request, response) => {
    const name = request.url.slice(1);
    if (!secrets[name]) {
      response.writeHead(503).end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const payload = Buffer.concat(chunks);
      const signature = request.headers["stripe-signature"];
      const event =
        name === "snapshot"
          ? stripe.webhooks.constructEvent(payload, signature, secrets[name])
          : stripe.parseEventNotification(
              payload.toString(),
              signature,
              secrets[name],
            );
      results[name] = {
        status: "pass",
        eventType: event.type,
        signatureVerified: true,
      };
      if (event.account || event.context)
        results.connect = { status: "pass", signatureVerified: true };
      response.writeHead(200).end();
    } catch {
      results[name] = { status: "fail", code: "signature_verification" };
      response.writeHead(400).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    for (const name of ["snapshot", "thin"]) {
      const target = `http://127.0.0.1:${server.address().port}/${name}`;
      const args =
        name === "snapshot"
          ? [
              "--all-snapshot",
              "--forward-to",
              target,
              "--forward-connect-to",
              target,
            ]
          : [
              "--thin-events",
              "*",
              "--forward-thin-to",
              target,
              "--forward-thin-connect-to",
              target,
            ];
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith("STRIPE_"),
        ),
      );
      const child = spawnProcess(cli, ["--config", config, "listen", ...args], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      results[name] = { status: "blocked", code: "listener_not_ready" };
      let output = "";
      const capture = (chunk) => {
        output = (output + chunk.toString()).slice(-8192);
        const secret = output.match(/whsec_[A-Za-z0-9]+/);
        if (secret) secrets[name] = secret[0];
      };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      child.on("error", () => {
        results[name] = { status: "fail", code: "listener_spawn" };
      });
    }
    const readyDeadline = Date.now() + waitMs;
    while (Date.now() < readyDeadline && Object.keys(secrets).length < 2)
      await delay(100);
    const capabilities = await run();
    const deliveryDeadline = Date.now() + waitMs;
    while (
      Date.now() < deliveryDeadline &&
      ["snapshot", "thin", "connect"].some(
        (name) => results[name]?.status !== "pass",
      )
    )
      await delay(100);
    for (const name of ["snapshot", "thin", "connect"])
      if (results[name]?.status !== "pass")
        results[name] = {
          status: "fail",
          code:
            secrets[name] || name === "connect"
              ? "no_verified_event"
              : "listener_not_ready",
        };
    return { ...capabilities, webhooks: results };
  } finally {
    for (const child of children) {
      if (child.exitCode !== null || !child.pid) continue;
      const exited = once(child, "exit");
      child.kill("SIGINT");
      await Promise.race([exited, delay(2000)]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
