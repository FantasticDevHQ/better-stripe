import { afterEach, expect, it, vi } from "vitest";
import { prepareRenewalAttachmentOperation } from "./index.js";
import { configurationInput } from "./billing/renewalAttach/internal/acquisition/test-fixtures/fixture.mjs";

function options() {
  const preparation = configurationInput().preparation;
  preparation.subscription.discounts = [];
  preparation.subscription.items.data[0].discounts = [];
  return {
    preparation,
    authorization: { scope: "host", id: "consent", revision: 3 },
    logicalOperationId: "retained-operation",
    attachKey: "caller-retained-attach-key",
    firstDispatchedAt: preparation.expected.periodStart + 60,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retains complete source material and original deadlines without provider I/O", async () => {
  const fetch = vi.fn(() => {
    throw Error("unexpected provider I/O");
  });
  vi.stubGlobal("fetch", fetch);
  const input = options();
  input.preparation.subscription.metadata = { opaque: "keep this source" };
  const built = await prepareRenewalAttachmentOperation(input);
  const record = JSON.parse(built.createArgs.recordJSON);
  expect(record.originalBundle.wireSubscription).toEqual(
    input.preparation.subscription,
  );
  expect(record.authorization).toEqual(input.authorization);
  expect(record.dispatch.key).toBe(input.attachKey);
  expect(record.dispatch.firstDispatchedAt).toBe(input.firstDispatchedAt);
  expect(record.timingPolicy.workEndWallMs).toBe(
    input.firstDispatchedAt * 1000 + 30_000,
  );
  input.preparation.subscription.metadata.opaque = "mutated later";
  expect(
    JSON.parse(built.createArgs.recordJSON).originalBundle.wireSubscription
      .metadata.opaque,
  ).toBe("keep this source");
  expect(fetch).not.toHaveBeenCalled();
});

it("prepares the same retained operation without refreshing its time or identity", async () => {
  const input = options();
  const first = await prepareRenewalAttachmentOperation(input);
  vi.spyOn(Date, "now").mockReturnValue(9_000_000_000_000);
  expect(await prepareRenewalAttachmentOperation(input)).toEqual(first);
});

it("rejects flexible billing instead of silently widening the execution profile", async () => {
  const input = options();
  input.preparation.subscription.billing_mode = {
    type: "flexible",
    flexible: { proration_discounts: "included" },
  };
  await expect(prepareRenewalAttachmentOperation(input)).rejects.toThrow();
});

it("refuses empty lists when a customer discount would be inherited", async () => {
  const input = options();
  Object.assign(input.preparation.billingCustomer, {
    discount: { id: "di_inherited", object: "discount" },
  });
  await expect(prepareRenewalAttachmentOperation(input)).rejects.toThrow();
});
