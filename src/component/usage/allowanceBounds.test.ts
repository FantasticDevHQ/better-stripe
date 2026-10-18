import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { setupAllowance } from "./allowance.fixtures.js";
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`usageAllowance/mutations:${name}`);
const reconciliation = makeFunctionReference<"query">(
  "usageAllowance/queries:reconciliation",
);
const record = makeFunctionReference<"mutation">("usage/mutations:record");
afterEach(() => vi.useRealTimers());
for (const commit of [false, true])
  it(`matches exactly 500 ${commit ? "accepted events" : "open reservations"} and holds 501 without repairing`, async () => {
    const { t, event, subscription, bindingJson, configure } =
      await setupAllowance();
    await configure({
      reset: "billing_period",
      rollover: "none",
      entitled: true,
      overage: "allow",
      limit: { mode: "hard", quantity: "1000" },
    });
    const add = async (i: number) => {
      const args = {
        inputJson: JSON.stringify({
          ...event,
          sourceEventId: `bound_${i}`,
          quantity: "1",
        }),
        subscriptionJson: JSON.stringify(subscription),
      };
      const reserved = await t.mutation(mutation("reserve"), args);
      expect(reserved.state).toBe("reserved");
      if (commit)
        await t.mutation(record, {
          ...args,
          reservationId: reserved.reservationId,
        });
    };
    for (let i = 0; i < 500; i++) await add(i);
    expect(await t.query(reconciliation, { bindingJson })).toMatchObject({
      status: "matched",
      consumedScaledQuantity: commit ? "500" : "0",
      reservedScaledQuantity: commit ? "0" : "500",
      repaired: false,
    });
    await add(500);
    expect(await t.query(reconciliation, { bindingJson })).toMatchObject({
      status: "held",
      reason: "local_evidence_incomplete",
      consumedScaledQuantity: commit ? "501" : "0",
      reservedScaledQuantity: commit ? "0" : "501",
      repaired: false,
    });
  }, 30000);
it("commits the 100000th allowance audit entry and rolls back one over the retained quota", async () => {
  const { t, configure, args } = await setupAllowance();
  await configure();
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("usageAllowancePolicies").first())!;
    await ctx.db.patch(row._id, { historyCount: 99999 });
  });
  const reservation = await t.mutation(mutation("reserve"), args);
  expect(reservation.state).toBe("reserved");
  await expect(
    t.mutation(record, { ...args, reservationId: reservation.reservationId }),
  ).rejects.toThrow(/history quota/i);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("usageEvents").first()).toBeNull();
    expect(await ctx.db.query("usageOutbox").first()).toBeNull();
    expect(await ctx.db.query("usageReservations").first()).toMatchObject({
      state: "reserved",
    });
    expect(await ctx.db.query("usageAllowancePolicies").first()).toMatchObject({
      historyCount: 100000,
      consumed: "0",
      reserved: "6",
    });
  });
});
