import { afterEach, expect, it, vi } from "vitest";
import { BetterStripe } from "../../../src/client/index.js";
import type { RunCtx } from "../../../src/client/helpers.js";
import { fixture } from "../../../src/client/usage/subscriptionTransport.fixtures.js";
import { request } from "../../../src/client/usage/subscription.fixtures.js";
import { ensureManagedSubscription } from "../../../src/client/usage/subscriptionProvider.js";
import * as allowance from "./allowance";
afterEach(() => vi.useRealTimers());
it("repairs setup after saved allowance but missing host binding without rewriting policy or revision", async () => {
  expect(allowance.ensureDemoAllowance).toBeTypeOf("function");
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const f = fixture(),
    client = new BetterStripe(f.component);
  const view = await f.t.action((ctx) =>
    ensureManagedSubscription(f.stripe, f.component, ctx as RunCtx, request),
  );
  const original = view.bindings[0];
  await f.t.action((ctx) =>
    allowance.ensureDemoAllowance(ctx as RunCtx, client.usage, original),
  );
  await f.t.action((ctx) =>
    allowance.ensureDemoAllowance(ctx as RunCtx, client.usage, original),
  );
  const status = await f.t.action((ctx) =>
    client.usage.getAllowanceStatus(ctx as RunCtx, original),
  );
  expect(status?.revision).toBe(1);
  expect(status?.policy.limit).toEqual({ mode: "soft", quantity: "12" });
  await f.t.action((ctx) =>
    client.usage.configureAllowance(ctx as RunCtx, {
      ...original,
      expectedRevision: 1,
      policy: { ...status!.policy, entitled: false },
    }),
  );
  await expect(
    f.t.action((ctx) =>
      allowance.ensureDemoAllowance(ctx as RunCtx, client.usage, original),
    ),
  ).rejects.toThrow(/original allowance policy/);
  expect(
    (
      await f.t.action((ctx) =>
        client.usage.getAllowanceStatus(ctx as RunCtx, original),
      )
    )?.revision,
  ).toBe(2);
});
it("keeps future test-clock renewals unavailable until their real active period", () => {
  expect(allowance.demoRenewalActive({ start: 100, end: 200 }, 99)).toBe(false);
  expect(allowance.demoRenewalActive({ start: 100, end: 200 }, 100)).toBe(true);
  expect(allowance.demoRenewalActive({ start: 100, end: 200 }, 200)).toBe(
    false,
  );
});
