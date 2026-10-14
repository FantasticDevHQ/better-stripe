import { componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import { handleV2Event } from "./webhooks/v2.js";
import type { WebhookContext } from "./webhooks/helpers.js";
import type { V2ThinEvent } from "./types.js";
it("syncs a preview customer without requesting merchant, recipient or Connect requirements", async () => {
  const retrieve = vi.fn().mockResolvedValue({
    id: "acct_buyer",
    metadata: { userId: "buyer" },
    configuration: { customer: { applied: true } },
    applied_configurations: ["customer"],
    identity: { country: "us" },
  });
  const runMutation = vi.fn();
  const ctx = {
    component: componentsGeneric().betterStripe,
    ctx: { runMutation },
    stripe: { v2: { core: { accounts: { retrieve } } } },
    config: { stripeApiVersion: "2026-09-30.preview" },
  } as unknown as WebhookContext;
  await handleV2Event(ctx, {
    id: "evt_preview",
    type: "v2.core.account[configuration.customer].updated",
    context: "acct_merchant",
    related_object: { id: "acct_buyer", type: "v2.core.account" },
  } as V2ThinEvent);
  expect(retrieve).toHaveBeenCalledWith(
    "acct_buyer",
    { include: ["configuration.customer", "identity"] },
    { stripeContext: "acct_merchant" },
  );
  expect(runMutation).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      userId: "buyer",
      stripeAccountId: "acct_buyer",
      appliedConfigurations: ["customer"],
      onboardingStatus: "complete",
    }),
  );
});
