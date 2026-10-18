import { expect, it, vi } from "vitest";
import * as cleanup from "./cleanupRefresh";
const saved = {
  status: "paid",
  invoiceId: "in_original",
  revenue: [{ cash: { status: "ready" }, settlement: { status: "settled" } }],
};
it.each(["refunded", "disputed", "unknown"])(
  "blocks a previously settled run when fresh original cash is %s",
  async (status) => {
    const read = vi.fn(async () => ({
      ...saved,
      revenue: [{ cash: { status } }],
    }));
    await expect(
      cleanup.refreshDemoCleanupEvidence(saved, read),
    ).rejects.toThrow(/cash/i);
    expect(read).toHaveBeenCalledWith("in_original");
  },
);
it("blocks incomplete settlement recovery even when original cash is ready", async () => {
  await expect(
    cleanup.refreshDemoCleanupEvidence(saved, async () => ({
      ...saved,
      revenue: [
        { cash: { status: "ready" }, settlement: { status: "unknown" } },
      ],
    })),
  ).rejects.toThrow(/settlement/i);
});
it("requires fresh evidence for exactly the retained original invoice", async () => {
  await expect(
    cleanup.refreshDemoCleanupEvidence(saved, async () => ({
      ...saved,
      invoiceId: "in_other",
    })),
  ).rejects.toThrow(/original invoice/i);
  expect(
    await cleanup.refreshDemoCleanupEvidence(saved, async () => saved),
  ).toEqual(saved);
});
it("does not refresh an unresolved or absent original invoice", async () => {
  const read = vi.fn();
  await expect(
    cleanup.refreshDemoCleanupEvidence(null, read),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
