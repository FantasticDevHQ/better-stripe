// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const raw = vi.hoisted(() => ({
  invoices: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
const modules = import.meta.glob("./**/*.*s");
it("does not try to append renewal costs to an already-paid initial invoice", async () => {
  const t = convexTest(schema, modules);
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_initial",
    status: "paid",
    billing_reason: "subscription_create",
    parent: { subscription_details: { subscription: "sub_plan" } },
  });
  raw.subscriptions.retrieve.mockResolvedValue({
    metadata: { storeBilling: "plan_v1", sellerId: "unused" },
  });
  await expect(
    t.action(internal.storeBillingEvents.process, {
      type: "invoice.created",
      objectId: "in_initial",
    }),
  ).resolves.toBeNull();
  expect(raw.invoices.retrieve).toHaveBeenCalledTimes(1);
});
