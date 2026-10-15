import type Stripe from "stripe";
import { expect, it } from "vitest";
import { successfulRefundPrincipal } from "./refundPrincipal.js";
const provider = (refunds: { amount: number; status: string }[]) =>
  ({
    refunds: {
      list: () =>
        (async function* () {
          yield* refunds;
        })(),
    },
  }) as unknown as Stripe;
it("excludes pending, failed and canceled refunds from the finalized cumulative principal", async () => {
  expect(
    await successfulRefundPrincipal(
      provider([
        { amount: 100, status: "succeeded" },
        { amount: 200, status: "pending" },
        { amount: 300, status: "failed" },
        { amount: 400, status: "canceled" },
        { amount: 500, status: "succeeded" },
        { amount: 600, status: "requires_action" },
      ]),
      "ch_1",
    ),
  ).toBe(600);
});
it("fails closed on invalid money and a refund history beyond the supported bound", async () => {
  await expect(
    successfulRefundPrincipal(
      provider([{ amount: -1, status: "succeeded" }]),
      "ch_1",
    ),
  ).rejects.toThrow("Invalid");
  await expect(
    successfulRefundPrincipal(
      provider(
        Array.from({ length: 1001 }, () => ({
          amount: 1,
          status: "succeeded",
        })),
      ),
      "ch_1",
    ),
  ).rejects.toThrow("limit exceeded");
});
