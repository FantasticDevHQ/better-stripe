import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import type { MutationCtx } from "../_generated/server.js";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";
import { normalizeRefundCommandBindings } from "./mutations.js";

it("propagates a simulated resource failure atomically and keeps the legacy coverage hold", async () => {
  const t = convexTest(schema, modules);
  const scope = {
    commandKey: "dojo-refund:resource_command:v1",
    accountId: "acct_original",
    stripePaymentIntentId: "pi_original",
    stripeChargeId: "ch_original",
    currency: "jpy",
  };
  const rows = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 2; i++)
      ids.push(
        await ctx.db.insert("refunds", {
          stripeRefundId: `re_resource${i}`,
          accountId: scope.accountId,
          stripePaymentIntentId: scope.stripePaymentIntentId,
          stripeChargeId: scope.stripeChargeId,
          currency: scope.currency,
          amount: 100,
          status: "pending",
          metadata: { betterStripeRefundCommand: scope.commandKey },
        }),
      );
    return Promise.all(ids.map((id) => ctx.db.get("refunds", id)));
  });
  const failure = new Error(
    "Simulated native resource limit; no real capacity claim",
  );
  const handler = (
    normalizeRefundCommandBindings as unknown as {
      _handler: (
        ctx: MutationCtx,
        args: { limit: number },
      ) => Promise<{ normalized: number; hasMore: boolean }>;
    }
  )._handler;
  await expect(
    t.mutation(async (ctx) => {
      const originalPatch = ctx.db.patch.bind(ctx.db);
      const patch = vi
        .spyOn(ctx.db, "patch")
        .mockImplementationOnce(originalPatch)
        .mockRejectedValueOnce(failure);
      try {
        return await handler(ctx, { limit: 2 });
      } finally {
        patch.mockRestore();
      }
    }),
  ).rejects.toBe(failure);
  expect(
    await t.run((ctx) =>
      Promise.all(rows.map((row) => ctx.db.get("refunds", row!._id))),
    ),
  ).toEqual(rows);
  expect(
    await t.query(api.refundHistory.queries.getRefundCommandEvidence, scope),
  ).toEqual({ status: "unavailable", reason: "normalization_incomplete" });
  const normalize = makeFunctionReference<
    "mutation",
    { limit: number },
    { normalized: number; hasMore: boolean }
  >("refundHistory/mutations:normalizeRefundCommandBindings");
  expect(await t.mutation(normalize, { limit: 1 })).toEqual({
    normalized: 1,
    hasMore: true,
  });
});
