import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modules, schema } from "../../../test";

const sdk = vi.hoisted(() => ({ createSession: vi.fn() }));
vi.mock("../../stripe/helpers", () => ({
  stripe: { createBillingPortalSession: sdk.createSession },
}));

const flowData = {
  type: "subscription_update_confirm" as const,
  subscription_update_confirm: {
    subscription: "sub_original",
    items: [{ id: "si_original", price: "price_target" }],
  },
  after_completion: {
    type: "redirect" as const,
    redirect: { return_url: "https://host.example/billing/confirmed" },
  },
};
const ordinary = {
  stripeAccountId: "acct_customer",
  returnUrl: "https://host.example/billing",
};
const options = { ...ordinary, configurationId: "bpc_policy", flowData };
const reference = makeFunctionReference<
  "action",
  typeof options & { connectedAccountId?: string },
  { url: string }
>("billing/public/actions:createBillingPortalSession");
const ordinaryReference = makeFunctionReference<
  "action",
  typeof ordinary,
  { url: string }
>("billing/public/actions:createBillingPortalSession");

beforeEach(() => {
  sdk.createSession.mockReset();
  sdk.createSession.mockResolvedValue({ url: "https://billing.stripe.test" });
});

describe("registered example portal action", () => {
  // This raw demo forwarder has no actor/target policy. Targeted calls belong to storePlans.manage.
  it.each([undefined, "acct_connected"])(
    "does not expose targeted authority through the raw demo forwarder in scope %s",
    async (connectedAccountId) => {
      const t = convexTest(schema, modules);
      const input = {
        ...options,
        ...(connectedAccountId ? { connectedAccountId } : {}),
      };
      await expect(t.action(reference, input)).rejects.toThrow();
      expect(sdk.createSession).not.toHaveBeenCalled();
    },
  );

  it("preserves the existing ordinary-session action contract", async () => {
    const t = convexTest(schema, modules);
    await t.action(ordinaryReference, ordinary);
    expect(sdk.createSession).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      ordinary,
    );
  });

  it.each([
    null,
    true,
    [],
    { ...flowData, type: "subscription_update" },
    { ...flowData, unknownPolicy: true },
    {
      ...flowData,
      subscription_update_confirm: { subscription: 42, items: [] },
    },
    {
      ...flowData,
      subscription_update_confirm: {
        subscription: "sub_original",
        items: [{ id: "si_original", price: "price_target", quantity: -1 }],
      },
    },
    {
      ...flowData,
      after_completion: { type: "redirect", redirect: { return_url: false } },
    },
  ])(
    "rejects malformed registered input before the SDK call: %j",
    async (untrusted) => {
      const t = convexTest(schema, modules);
      const input = { ...options, flowData: untrusted } as typeof options;
      await expect(t.action(reference, input)).rejects.toThrow();
      expect(sdk.createSession).not.toHaveBeenCalled();
    },
  );
});
