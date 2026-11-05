import { spawn } from "node:child_process";

// Explicit selection excludes unsupported V1 resource thin events. See the
// Stripe event-type reference and src/client/webhooks/{v2,meterErrors}.ts.
export const thinEvents = [
  "v2.core.account.closed",
  "v2.core.account.created",
  "v2.core.account.updated",
  ...["customer", "merchant", "recipient"].flatMap((configuration) => [
    `v2.core.account[configuration.${configuration}].capability_status_updated`,
    `v2.core.account[configuration.${configuration}].updated`,
  ]),
  ...["defaults", "future_requirements", "identity", "requirements"].map(
    (part) => `v2.core.account[${part}].updated`,
  ),
  "v2.core.account_link.returned",
  "v2.core.account_person.created",
  "v2.core.account_person.deleted",
  "v2.core.account_person.updated",
  "v1.billing.meter.error_report_triggered",
  "v1.billing.meter.no_meter_found",
];

export function startListeners({
  cli,
  config,
  secretKey,
  sitePort,
  environment = process.env,
  spawnProcess = spawn,
}) {
  if (!Number.isInteger(sitePort) || sitePort < 1 || sitePort > 65535)
    throw new Error("Stripe listener requires a valid reserved site port.");
  const target = `http://127.0.0.1:${sitePort}/stripe/webhook`;
  const env = Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith("STRIPE_")),
  );
  env.STRIPE_API_KEY = secretKey;
  const children = [];
  let stopping = false;
  let rejectFailure;
  const failure = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  void failure.catch(() => {});
  const pending = [];
  const ready = Promise.all(
    ["snapshot", "thin"].map(
      (name) =>
        new Promise((resolve, reject) => {
          pending.push(reject);
          const fail = () => {
            if (stopping) return;
            const error = new Error(`Stripe ${name} listener failed.`);
            reject(error);
            rejectFailure(error);
          };
          try {
            const forwarding =
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
                    thinEvents.join(","),
                    "--forward-thin-to",
                    target,
                    "--forward-thin-connect-to",
                    target,
                  ];
            const child = spawnProcess(
              cli,
              ["--config", config, "listen", ...forwarding],
              { env, stdio: ["ignore", "pipe", "pipe"], shell: false },
            );
            children.push(child);
            child.once("error", fail);
            child.once("close", fail);
            for (const stream of [child.stdout, child.stderr]) {
              let buffer = "";
              stream.on("data", (chunk) => {
                buffer = (buffer + chunk.toString()).replace(
                  /\u001b\[[0-9;]*m/g,
                  "",
                );
                let end;
                while ((end = buffer.indexOf("\n")) >= 0) {
                  const line = buffer.slice(0, end);
                  buffer = buffer.slice(end + 1);
                  const match = line.match(
                    /Ready!.*webhook signing secret is (whsec_[A-Za-z0-9]+)/,
                  );
                  if (match) resolve(match[1]);
                }
                buffer = buffer.slice(-8192);
              });
            }
          } catch {
            fail();
          }
        }),
    ),
  ).then(([snapshot, thin]) => ({
    STRIPE_WEBHOOK_SECRET: snapshot,
    STRIPE_WEBHOOK_SECRET_V2: thin,
  }));
  void ready.catch(() => {});
  let stopPromise;
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopping = true;
    for (const reject of pending)
      reject(new Error("Stripe listener startup interrupted."));
    stopPromise = Promise.all(
      children.map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await new Promise((resolve) => {
          const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
          child.once("close", () => {
            clearTimeout(timer);
            resolve();
          });
          child.kill("SIGINT");
        });
      }),
    );
    return stopPromise;
  };
  return { ready, failure, stop };
}
