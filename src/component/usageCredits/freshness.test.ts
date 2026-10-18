import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { setupCredits } from "./accounting.fixtures.js";
const ref = (name: string) =>
  makeFunctionReference<"mutation">(`usageCredits/mutations:${name}`);
afterEach(() => vi.useRealTimers());
for (const age of [60000, 60001])
  it(`uses native proof wall time rather than a future logical order at age ${age}ms`, async () => {
    const { t, purchase, row } = await setupCredits();
    await t.mutation(ref("saveObservation"), {
      inputJson: JSON.stringify(purchase),
      startedAt: Date.now() + 100000,
      proofJson: JSON.stringify({
        creditGrantId: "credgr_topup1",
        paymentIntentId: "pi_topup1",
        currency: "usd",
        ledgerAmount: 20,
        availableAmount: 20,
        granted: 20,
        applied: 0,
        expired: 0,
        voided: 0,
        reinstated: 0,
        invoicesVerified: true,
        complete: true,
        transactions: [],
      }),
    });
    vi.setSystemTime(Date.now() + age);
    const prepare = t.mutation(ref("prepareRefund"), { key: row.key });
    if (age === 60000) await expect(prepare).resolves.toBeNull();
    else await expect(prepare).rejects.toThrow(/current.*reconciliation/i);
  });
