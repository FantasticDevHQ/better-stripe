import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { componentsGeneric, defineSchema } from "convex/server";
import { BetterStripe } from "@fantastic.dev/better-stripe";
import {
  authorizeUsageRecord,
  prepareUsageRecord,
} from "@fantastic.dev/better-stripe/usage";
import schema from "./dist/component/schema.js";

// Self-reference resolution must bind to the extracted archive, never the repository SDK.
assert.equal(
  fileURLToPath(import.meta.resolve("@fantastic.dev/better-stripe")),
  resolve("dist/client/index.js"),
);
assert.equal(
  fileURLToPath(import.meta.resolve("@fantastic.dev/better-stripe/usage")),
  resolve("dist/client/usage/index.js"),
);

// Register the actual archived component implementation; no facade or ledger mock.
const modules = {
  "./_generated/server.js": () =>
    import("./dist/component/_generated/server.js"),
  "./usage/mutations.js": () => import("./dist/component/usage/mutations.js"),
  "./usage/queries.js": () => import("./dist/component/usage/queries.js"),
};
const t = convexTest(defineSchema({}), modules);
t.registerComponent("betterStripe", schema, modules);
const stripe = new BetterStripe(componentsGeneric().betterStripe);
let providerCalls = 0;
globalThis.fetch = async () => {
  providerCalls++;
  throw new Error("Unexpected provider I/O");
};
const now = Math.floor(Date.now() / 1000);
const event = {
  scope: {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  },
  binding: {
    stripeCustomerId: "cus_buyer",
    stripePriceId: "price_calls",
    eventName: "calls",
    plan: {
      key: "calls",
      version: "v1",
      model: "pay_as_you_go",
      unit: { name: "call", precision: 2 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
    },
  },
  sourceEventId: "packed_activity",
  quantity: "1.20",
  occurredAt: now,
};
const subscription = {
  subscriptionId: "sub_calls",
  subscriptionItemId: "si_calls",
  stripePriceId: "price_calls",
  period: { start: now - 1, end: now + 100 },
  interval: "month",
};
const record = (input) =>
  t.run((ctx) => stripe.usage.record(ctx, { event: input, subscription }));
const receipt = await t.run((ctx) =>
  authorizeUsageRecord(
    ctx,
    { authorize: async () => {}, authorizeActivity: async () => {} },
    event,
    (prepared) => stripe.usage.record(ctx, { event: prepared, subscription }),
  ),
);
assert.equal(receipt.delivery, "queued");
assert.deepEqual(await record(event), receipt);
await assert.rejects(
  record(prepareUsageRecord({ ...event, quantity: "1.21" })),
);
await assert.rejects(record({ ...event, extra: true }));
for (const boundary of ["scope", "activity"]) {
  await assert.rejects(
    t.run((ctx) =>
      authorizeUsageRecord(
        ctx,
        {
          authorize: async () => {
            if (boundary === "scope") throw new Error("Scope denied");
          },
          authorizeActivity: async () => {
            throw new Error("Activity denied");
          },
        },
        { ...event, sourceEventId: `denied_${boundary}` },
        (prepared) =>
          stripe.usage.record(ctx, { event: prepared, subscription }),
      ),
    ),
  );
}
const prepared = prepareUsageRecord(event);
const partial = { ...prepared };
delete partial.identity;
for (const input of [
  { ...prepared, identity: "forged" },
  { ...prepared, scaledQuantity: "121" },
  { ...prepared, schemaVersion: 2 },
  { ...prepared, quantity: "1.21" },
  { ...prepared, quantity: "1.20" },
  {
    ...prepared,
    binding: {
      ...prepared.binding,
      plan: { ...prepared.binding.plan, unit: { name: "call", precision: 1 } },
    },
  },
  { ...prepared, extra: true },
  { ...prepared, binding: { ...prepared.binding, extra: true } },
  partial,
])
  await assert.rejects(record(input));
const page = await t.run((ctx) =>
  stripe.usage.read(ctx, {
    scope: event.scope,
    page: { period: subscription.period, limit: 10, cursor: null },
  }),
);
assert.equal(page.events.length, 1);
assert.equal(page.events[0].record.scaledQuantity, "120");
assert.equal(providerCalls, 0);
console.log(
  JSON.stringify({
    composition: true,
    replay: true,
    eventCount: 1,
    tamperRejections: 9,
    authorizationDenials: 2,
    providerCalls,
    archiveExports: true,
  }),
);
