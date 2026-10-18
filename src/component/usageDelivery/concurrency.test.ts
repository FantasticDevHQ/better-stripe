import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import { schema, modules } from "../../test.js";
const record = makeFunctionReference<"mutation">("usage/mutations:record"),
  claim = makeFunctionReference<"mutation">("usageDelivery/steps:claim");
it("serializes the same native customer/meter even across distinct authorized payer scopes", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules),
      now = Math.floor(Date.now() / 1000);
    const accepted = [];
    for (const customerAccount of ["acct_aliasA", "acct_aliasB"]) {
      const scope = {
        stripeAccountId: "acct_platform",
        customerAccount,
        meterId: "mtr_calls",
        livemode: false,
      };
      const receipt = await t.mutation(record, {
        inputJson: JSON.stringify({
          scope,
          binding: {
            stripeCustomerId: "cus_shared",
            stripePriceId: "price_calls",
            eventName: "calls",
            plan: {
              key: "calls",
              version: "v1",
              model: "pay_as_you_go",
              unit: { name: "call", precision: 0 },
              rate: { currency: "usd", unitAmountDecimal: "2" },
            },
          },
          sourceEventId: "one",
          quantity: "1",
          occurredAt: now,
        }),
        subscriptionJson: JSON.stringify({
          subscriptionId: "sub_calls",
          subscriptionItemId: "si_calls",
          stripePriceId: "price_calls",
          period: { start: now - 1, end: now + 86400 },
          interval: "month",
        }),
      });
      accepted.push({ scope, eventId: receipt.eventId });
    }
    expect(await t.mutation(claim, accepted[0])).toMatchObject({
      kind: "ready",
    });
    vi.setSystemTime(Date.now() + 2000);
    expect(await t.mutation(claim, accepted[1])).toMatchObject({
      kind: "wait",
      delayMs: 60000,
    });
    const rows = await t.run((ctx) => ctx.db.query("usageOutbox").take(2));
    expect(rows.map((r) => r.attempts)).toEqual([1, 0]);
  } finally {
    vi.useRealTimers();
  }
});
