import { expect, it } from "vitest";
import type { RunCtx } from "../helpers.js";
import { ensureManagedSubscription } from "./subscriptionProvider.js";
import { request } from "./subscription.fixtures.js";
import { fixture } from "./subscriptionTransport.fixtures.js";
it("creates flexible mixed subscriptions without metered quantity and replays the pinned native identity", async () => {
  const f = fixture();
  const result = await f.t.action((ctx) =>
    ensureManagedSubscription(f.stripe, f.component, ctx as RunCtx, request),
  );
  expect(result.bindings[0].subscription.subscriptionItemId).toBe("si_calls");
  const writes = f.calls.filter((c) => c.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0].body.get("billing_mode[type]")).toBe("flexible");
  expect(writes[0].body.get("items[0][quantity]")).toBeNull();
  expect(writes[0].body.get("customer_account")).toBe("acct_buyer");
  expect(writes[0].key).toMatch(/^bs_usage_sub_/);
  const again = await f.t.action((ctx) =>
    ensureManagedSubscription(f.stripe, f.component, ctx as RunCtx, request),
  );
  expect(again.subscriptionId).toBe(result.subscriptionId);
  expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(1);
});
it("refuses another active subscription sharing native customer/meter without creating anything", async () => {
  const f = fixture(true);
  await expect(
    f.t.action((ctx) =>
      ensureManagedSubscription(f.stripe, f.component, ctx as RunCtx, request),
    ),
  ).rejects.toThrow(/overlap/i);
  expect(f.calls.some((c) => c.method === "POST")).toBe(false);
});
it("redacts ambiguous provider failures and retains the same durable request for recovery", async () => {
  const f = fixture(false, true);
  await expect(
    f.t.action((ctx) =>
      ensureManagedSubscription(f.stripe, f.component, ctx as RunCtx, request),
    ),
  ).rejects.toThrow("Native usage subscription unavailable");
  await expect(
    f.t.action((ctx) =>
      ensureManagedSubscription(f.stripe, f.component, ctx as RunCtx, request),
    ),
  ).rejects.toThrow("Native usage subscription unavailable");
  const writes = f.calls.filter((c) => c.method === "POST");
  expect(writes).toHaveLength(2);
  expect(writes[0].key).toBe(writes[1].key);
});
