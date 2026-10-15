import { expect, it } from "vitest";
import { planRecipientPayout } from "./allocation.js";
import { summarizePayoutProgress } from "./progress.js";
it("keeps paid, reserved, mature and pending amounts in their own currency", () => {
  const sources = [
    {
      stripeTransferId: "tr_usd",
      currency: "usd",
      role: "store" as const,
      matureNet: 1000,
      paidAmount: 0,
      reservedAmount: 0,
      pendingCredits: 0,
    },
    {
      stripeTransferId: "tr_eur",
      currency: "eur",
      role: "affiliate" as const,
      matureNet: 7000,
      paidAmount: 2000,
      reservedAmount: 500,
      pendingCredits: 999,
    },
  ];
  const plan = planRecipientPayout({
    currency: "usd",
    threshold: 1000,
    providerAvailable: 1000,
    independentLiabilities: 0,
    sources,
  });
  expect(summarizePayoutProgress(plan, sources, 0)).toEqual({
    accounting: {
      carriedForwardAmount: 0,
      withheldAmount: 0,
      releasedAmount: 0,
      reservedAmount: 0,
    },
    sources: [
      {
        role: "store",
        matureUnpaid: 1000,
        pendingCredits: 0,
        releasedAmount: 0,
        reservedAmount: 0,
      },
      {
        role: "affiliate",
        matureUnpaid: 0,
        pendingCredits: 0,
        releasedAmount: 0,
        reservedAmount: 0,
      },
      {
        role: "other",
        matureUnpaid: 0,
        pendingCredits: 0,
        releasedAmount: 0,
        reservedAmount: 0,
      },
    ],
  });
});
